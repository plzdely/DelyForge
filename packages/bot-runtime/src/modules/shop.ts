import { activeSales, checkShopCode, findShopItem, formatPrice, saleFor, saleTargetLabel, type ShopConfig } from '@delyforge/shared';
import {
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  ComponentType,
  type Guild,
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  TextInputStyle,
} from 'discord.js';
import { type ModuleContext, sendableChannel, truncate } from './context.js';
import { openTicketWith } from './tickets.js';

/** Custom IDs: the Order button on the price list, the item menus it shows, and the order form. */
export const SHOP_CID = { order: 'df:shop:order', pick: (n: number) => `df:shop:pick:${n}`, form: (itemId: string) => `df:shop:form:${itemId}` } as const;

const ephemeral = (i: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, content: string) =>
  i.replied || i.deferred ? i.editReply({ content, allowedMentions: { parse: [] } }) : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** "~~$20~~ $16 (Black Friday, 20% off)" or "$20". */
function priceText(c: ShopConfig, categoryId: string, itemId: string, now: number): string {
  const found = findShopItem(c, itemId)!;
  const sale = saleFor(c, categoryId, itemId, now);
  return sale ? `~~${formatPrice(c.currency, found.item)}~~ ${formatPrice(c.currency, found.item, sale.percentOff)} (${sale.name}, ${sale.percentOff}% off)` : formatPrice(c.currency, found.item);
}

/** Unicode emoji only — menus need IDs for server emojis. */
const menuEmoji = (e: string) => (e.trim() && !e.includes('<') ? { name: e.trim() } : undefined);

/** Order button: shows the items to pick from (only you see it). */
export async function onShopOrder(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId);
  const c = config.shop;
  if (!c.enabled || !config.tickets.enabled) return void (await ephemeral(i, 'Ordering isn’t set up right now — please open a ticket instead.'));
  if (!c.ordersOpen) return void (await ephemeral(i, `🔴 Orders are closed. ${c.closedMessage}`));
  const now = Date.now();
  const options = c.categories.flatMap((cat) =>
    cat.items.map((item) => ({
      label: truncate(item.name, 100),
      value: item.id,
      description: truncate(`${cat.name} · ${priceText(c, cat.id, item.id, now).replace(/~~/g, '')}`, 100),
      emoji: menuEmoji(cat.emoji),
    })),
  );
  if (!options.length) return void (await ephemeral(i, 'The shop has no items yet.'));
  // shortcut: a message holds 5 menus of 25, so only the first 125 items can be picked; plenty for a price list.
  const rows = [];
  for (let n = 0; n < Math.min(options.length, 125); n += 25) {
    rows.push({ type: ComponentType.ActionRow as const, components: [{ type: ComponentType.StringSelect as const, custom_id: SHOP_CID.pick(n / 25), placeholder: n ? 'More items…' : 'What do you want to order?', options: options.slice(n, n + 25) }] });
  }
  await i.reply({ content: '🛒 Pick what you’d like — you can describe exactly what you want on the next step.', components: rows, flags: MessageFlags.Ephemeral });
}

/** An item was picked: ask for the details (and a discount code). */
export async function onShopPick(ctx: ModuleContext, i: StringSelectMenuInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const found = findShopItem(ctx.config(i.guildId).shop, i.values[0] ?? '');
  if (!found) return void (await ephemeral(i, 'That item isn’t in the shop any more.'));
  const c = ctx.config(i.guildId).shop;
  await i.showModal({
    title: truncate(`Order: ${found.item.name}`, 45),
    custom_id: SHOP_CID.form(found.item.id),
    components: [
      { type: ComponentType.ActionRow, components: [{ type: ComponentType.TextInput, custom_id: 'details', label: 'What do you want? (colours, references…)', style: TextInputStyle.Paragraph, required: true, max_length: 600 }] },
      ...(c.codes.length ? [{ type: ComponentType.ActionRow as const, components: [{ type: ComponentType.TextInput as const, custom_id: 'code', label: 'Discount code (optional)', style: TextInputStyle.Short, required: false, max_length: 20 }] }] : []),
    ],
  });
}

/** The order form was sent: open a ticket with the item, the price right now, and the details. */
export async function onShopForm(ctx: ModuleContext, i: ModalSubmitInteraction, itemId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId);
  const c = config.shop;
  if (!c.enabled || !config.tickets.enabled) return void (await ephemeral(i, 'Ordering isn’t set up right now — please open a ticket instead.'));
  if (!c.ordersOpen) return void (await ephemeral(i, `🔴 Orders are closed. ${c.closedMessage}`));
  const found = findShopItem(c, itemId);
  if (!found) return void (await ephemeral(i, 'That item isn’t in the shop any more.'));
  const now = Date.now();
  const sale = saleFor(c, found.category.id, itemId, now);
  const typed = c.codes.length ? i.fields.getTextInputValue('code').trim() : '';
  let codeLine = '';
  let code: string | null = null;
  if (typed) {
    const checked = checkShopCode(c.codes, typed, ctx.store.shopCount(i.guildId, `code:${typed.toUpperCase()}`), now);
    if (!checked.ok) return void (await ephemeral(i, `${checked.message} Nothing was ordered — try again without it, or with another code.`));
    code = checked.code.code;
    // Reserve the use right away (no await since the check), so two orders at once can't pass a use limit.
    ctx.store.bumpShopCount(i.guildId, `code:${code}`);
    codeLine = `\n**Code:** ${code} (−${checked.code.percentOff}%) → **${formatPrice(c.currency, found.item, sale?.percentOff ?? 0, checked.code.percentOff)}**`;
  }
  const reason = truncate(
    `🛒 **${found.item.name}** (${found.category.name})\n**Price:** ${priceText(c, found.category.id, itemId, now)}${codeLine}\n**Details:** ${i.fields.getTextInputValue('details').trim()}`,
    1000,
  );
  const opened = await openTicketWith(ctx, i, reason, c.ticketPanelId || null, 'Order');
  if (!opened && code) ctx.store.dropShopCount(i.guildId, `code:${code}`);
  if (opened) ctx.log('info', `Shop: ${i.user.tag} ordered ${found.item.name}${code ? ` with code ${code}` : ''}.`);
}

/** /price: anyone can look up what something costs right now. */
export async function handlePriceCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).shop;
  const typed = i.options.getString('item', true);
  // Picked from the suggestions (an ID), or typed by hand (a name).
  const found = findShopItem(c, typed) ?? c.categories.flatMap((cat) => cat.items.map((item) => ({ category: cat, item }))).find((x) => x.item.name.toLowerCase().includes(typed.toLowerCase()));
  if (!found) return void (await ephemeral(i, `Nothing in the shop matches “${truncate(typed, 50)}”.`));
  const now = Date.now();
  const sale = saleFor(c, found.category.id, found.item.id, now);
  const ends = sale ? ` — ends <t:${Math.floor(sale.endsAt / 1000)}:R>` : '';
  await i.reply({ content: `${found.category.emoji} **${found.item.name}** — ${priceText(c, found.category.id, found.item.id, now)}${ends}${c.ordersOpen ? '' : '\n-# 🔴 Orders are closed right now.'}`, allowedMentions: { parse: [] } });
}

/** Suggestions while typing /price. */
export async function onPriceAutocomplete(ctx: ModuleContext, i: AutocompleteInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).shop;
  const q = i.options.getFocused().toLowerCase();
  const now = Date.now();
  const choices = c.categories
    .flatMap((cat) => cat.items.map((item) => ({ cat, item })))
    .filter(({ cat, item }) => `${cat.name} ${item.name}`.toLowerCase().includes(q))
    .slice(0, 25)
    .map(({ cat, item }) => ({ name: truncate(`${item.name} (${cat.name}) — ${priceText(c, cat.id, item.id, now).replace(/~~/g, '')}`, 100), value: item.id }));
  await i.respond(choices).catch(() => null);
}

/** One vouch per member every 10 minutes, so the channel can't be flooded. */
const lastVouch = new Map<string, number>();

/** /vouch: a customer leaves a star rating and a review in the vouches channel. */
export async function handleVouchCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).shop;
  const channel = await sendableChannel(ctx, i.guild, c.vouchChannelId, 'Vouches');
  if (!channel) return void (await ephemeral(i, 'Vouches aren’t set up right now.'));
  const key = `${i.guildId}:${i.user.id}`;
  const wait = (lastVouch.get(key) ?? 0) + 600_000 - Date.now();
  if (wait > 0) return void (await ephemeral(i, `You just left a vouch — you can leave another in ${Math.ceil(wait / 60_000)} min.`));
  const stars = i.options.getInteger('stars', true);
  const image = i.options.getAttachment('image');
  const n = ctx.store.bumpShopCount(i.guildId, 'vouches');
  const sent = await channel
    .send({
      embeds: [
        {
          author: { name: i.member.displayName, icon_url: i.user.displayAvatarURL({ size: 64 }) },
          title: '⭐'.repeat(stars) + '☆'.repeat(5 - stars),
          description: truncate(i.options.getString('review', true), 1000),
          image: image?.contentType?.startsWith('image/') ? { url: image.url } : undefined,
          footer: { text: `Vouch #${n}` },
          color: 0xf5a524,
          timestamp: new Date().toISOString(),
        },
      ],
      allowedMentions: { parse: [] },
    })
    .catch((e: Error) => (ctx.log('warn', `Vouches: could not post: ${e.message}`), null));
  if (!sent) return void (await ephemeral(i, 'I couldn’t post your vouch — please tell staff.'));
  lastVouch.set(key, Date.now());
  await ephemeral(i, `Thanks for the vouch! It’s up in <#${channel.id}>.`);
}

/** Every 30 s: posts an announcement when a sale (with "announce" on) starts — once per sale. */
export async function announceSales(ctx: ModuleContext, guild: Guild, now = Date.now()): Promise<void> {
  const c = ctx.config(guild.id).shop;
  if (!c.enabled || !c.announceChannelId) return;
  for (const s of activeSales(c, now)) {
    if (!s.announce || ctx.store.bumpShopCount(guild.id, `announced:${s.id}:${s.startsAt}`) !== 1) continue;
    const channel = await sendableChannel(ctx, guild, c.announceChannelId, 'Shop sale announcement');
    if (!channel) continue;
    const deals = c.categories
      .flatMap((cat) => cat.items.map((item) => ({ cat, item })))
      .filter(({ cat, item }) => saleFor(c, cat.id, item.id, now)?.id === s.id)
      .slice(0, 12)
      .map(({ cat, item }) => `${cat.emoji} **${item.name}** — ~~${formatPrice(c.currency, item)}~~ **${formatPrice(c.currency, item, s.percentOff)}**`);
    await channel
      .send({
        content: c.announceRoleId ? `<@&${c.announceRoleId}>` : undefined,
        embeds: [
          {
            title: `🔥 ${s.name} — ${s.percentOff}% off ${saleTargetLabel(c, s)}!`,
            description: [...deals, '', `${c.channelId ? `Prices are updated in <#${c.channelId}>. ` : ''}Ends <t:${Math.floor(s.endsAt / 1000)}:R>.`].join('\n'),
            color: 0xf04d5e,
          },
        ],
        allowedMentions: { roles: c.announceRoleId ? [c.announceRoleId] : [] },
      })
      .then(
        () => ctx.log('info', `Shop: announced the “${s.name}” sale in #${channel.name}.`),
        (e: Error) => ctx.log('warn', `Shop: could not announce the sale: ${e.message}`),
      );
  }
}
