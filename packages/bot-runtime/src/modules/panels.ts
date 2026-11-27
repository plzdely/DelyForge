import { createHash } from 'node:crypto';
import { type ModuleConfigs, type PanelConfig, type RolePanelConfig, renderPriceList } from '@delyforge/shared';
import {
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  ButtonStyle,
  ComponentType,
  type Guild,
  type MessageCreateOptions,
} from 'discord.js';
import { type ModuleContext, hexToInt, sendableChannel } from './context.js';

/** Custom IDs the bot gives its buttons and menus: `df:<module>:<action>[:<args>]`. */
export const CID = {
  ticketOpen: 'df:ticket:open',
  ticketOpenFor: (panelId: string) => `df:ticket:open:${panelId}`,
  ticketClose: 'df:ticket:close',
  ticketCloseConfirm: 'df:ticket:closeconfirm',
  ticketClaim: 'df:ticket:claim',
  ticketReason: 'df:ticket:reason',
  verify: 'df:verify',
  roleButton: (panelId: string, roleId: string) => `df:rr:${panelId}:${roleId}`,
  roleMenu: (panelId: string) => `df:rrm:${panelId}`,
  shopOrder: 'df:shop:order',
} as const;

export interface DesiredPanel {
  key: string;
  channelId: string;
  payload: MessageCreateOptions;
  hash: string;
}

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

const embedOf = (p: { title: string; description: string; color: string }) => ({
  title: p.title,
  description: p.description || undefined,
  color: hexToInt(p.color),
});

const buttonPanel = (p: PanelConfig, customId: string, style: ButtonStyle): MessageCreateOptions => ({
  embeds: [embedOf(p)],
  components: [
    { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style, label: p.buttonLabel, custom_id: customId }] } as Row,
  ],
  allowedMentions: { parse: [] },
});

/** A unicode emoji for a component, or nothing (custom emojis would need IDs). */
const emoji = (e: string) => (e.trim() ? { name: e.trim() } : undefined);

function rolePanelMessage(p: RolePanelConfig): MessageCreateOptions {
  let components: Row[];
  if (p.mode === 'menu') {
    components = [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: CID.roleMenu(p.id),
            placeholder: p.multiple ? 'Pick your roles' : 'Pick a role',
            min_values: 0,
            max_values: p.multiple ? (p.maxRoles ? Math.min(p.maxRoles, p.roles.length) : p.roles.length) : 1,
            options: p.roles.map((r) => ({ label: r.label, value: r.roleId, emoji: emoji(r.emoji), description: r.description || undefined })),
          },
        ],
      } as Row,
    ];
  } else {
    components = [];
    for (let i = 0; i < p.roles.length; i += 5) {
      components.push({
        type: ComponentType.ActionRow,
        components: p.roles.slice(i, i + 5).map((r) => ({
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: r.label,
          emoji: emoji(r.emoji),
          custom_id: CID.roleButton(p.id, r.roleId),
        })),
      } as Row);
    }
  }
  return { embeds: [embedOf(p)], components, allowedMentions: { parse: [] } };
}

const hashOf = (payload: MessageCreateOptions) => createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);

/** The price list: plain-text messages (split at 2,000 characters) with the Order button under the last one. */
function shopPanels(config: ModuleConfigs, now: number): Omit<DesiredPanel, 'hash'>[] {
  const c = config.shop;
  if (!c.enabled || !c.channelId) return [];
  const channelId = c.channelId;
  const texts = renderPriceList(c, now);
  const order: Row[] =
    c.orderButton && config.tickets.enabled
      ? [
          {
            type: ComponentType.ActionRow,
            components: [
              c.ordersOpen
                ? { type: ComponentType.Button, style: ButtonStyle.Success, label: 'Order', emoji: { name: '🛒' }, custom_id: CID.shopOrder }
                : { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Orders closed', emoji: { name: '🔴' }, custom_id: CID.shopOrder, disabled: true },
            ],
          } as Row,
        ]
      : [];
  return texts.map((content, n) => ({ key: `shop:${n}`, channelId, payload: { content, embeds: [], components: n === texts.length - 1 ? order : [], allowedMentions: { parse: [] } } }));
}

/**
 * When the posted price list no longer matches (a sale started or ended): a short fingerprint of what it should be,
 * so the caller syncs once per change (not every check, if posting keeps failing). Null when it's up to date.
 */
export function shopPanelsStale(ctx: ModuleContext, guildId: string, now = Date.now()): string | null {
  const want = new Map(desiredPanels(ctx.config(guildId), now).filter((p) => p.key.startsWith('shop:')).map((p) => [p.key, p.hash]));
  const have = ctx.store.panels(guildId).filter((p) => p.key.startsWith('shop:'));
  const stale = have.length !== want.size || have.some((p) => want.get(p.key) !== p.hash);
  return stale ? [...want.values()].join(',') || 'removed' : null;
}

/** The panels a server should have, from its settings (the price list depends on the time, for sales). */
export function desiredPanels(config: ModuleConfigs, now = Date.now()): DesiredPanel[] {
  const out: Omit<DesiredPanel, 'hash'>[] = [];
  if (config.tickets.enabled && config.tickets.panel.channelId) {
    out.push({ key: 'tickets', channelId: config.tickets.panel.channelId, payload: buttonPanel(config.tickets.panel, CID.ticketOpen, ButtonStyle.Primary) });
  }
  if (config.tickets.enabled) {
    for (const p of config.tickets.extraPanels) {
      if (p.panel.channelId) out.push({ key: `tickets:${p.id}`, channelId: p.panel.channelId, payload: buttonPanel(p.panel, CID.ticketOpenFor(p.id), ButtonStyle.Primary) });
    }
  }
  if (config.verification.enabled && config.verification.panel.channelId && config.verification.roleId) {
    out.push({ key: 'verification', channelId: config.verification.panel.channelId, payload: buttonPanel(config.verification.panel, CID.verify, ButtonStyle.Success) });
  }
  if (config.reactionRoles.enabled) {
    for (const p of config.reactionRoles.panels) {
      if (p.channelId) out.push({ key: `rr:${p.id}`, channelId: p.channelId, payload: rolePanelMessage(p) });
    }
  }
  if (config.applications.enabled) {
    for (const f of config.applications.forms) {
      if (!f.panel.channelId || !f.reviewChannelId) continue;
      const payload = buttonPanel(f.open ? f.panel : { ...f.panel, buttonLabel: 'Applications closed' }, `df:app:open:${f.id}`, f.open ? ButtonStyle.Primary : ButtonStyle.Secondary);
      out.push({ key: `app:${f.id}`, channelId: f.panel.channelId, payload });
    }
  }
  out.push(...shopPanels(config, now));
  return out.map((p) => ({ ...p, hash: hashOf(p.payload) }));
}

/** Posts new panels, edits changed ones, and removes panels whose module or channel was turned off. */
export async function syncPanels(ctx: ModuleContext, guild: Guild): Promise<number> {
  const desired = desiredPanels(ctx.config(guild.id));
  const existing = new Map(ctx.store.panels(guild.id).map((p) => [p.key, p]));
  let changes = 0;

  const deleteOld = async (channelId: string, messageId: string) => {
    const ch = guild.channels.cache.get(channelId);
    if (ch?.isTextBased()) await ch.messages.delete(messageId).catch(() => null);
  };

  for (const want of desired) {
    const have = existing.get(want.key);
    existing.delete(want.key);
    if (have && have.channelId === want.channelId && have.hash === want.hash) continue;

    const channel = await sendableChannel(ctx, guild, want.channelId, `Panel “${want.key}”`);
    if (!channel) continue;
    if (have && have.channelId === want.channelId) {
      const edited = await channel.messages
        .edit(have.messageId, { content: want.payload.content, embeds: want.payload.embeds, components: want.payload.components })
        .then(() => true)
        .catch(() => false); // deleted by hand → post a fresh one below
      if (edited) {
        ctx.store.savePanel(guild.id, want.key, want.channelId, have.messageId, want.hash);
        changes++;
        continue;
      }
    } else if (have) {
      await deleteOld(have.channelId, have.messageId);
    }
    const msg = await channel.send(want.payload).catch((e: Error) => {
      ctx.log('warn', `Could not post panel “${want.key}” in #${channel.name}: ${e.message}`);
      return null;
    });
    if (msg) {
      ctx.store.savePanel(guild.id, want.key, want.channelId, msg.id, want.hash);
      changes++;
    }
  }

  // Sticky messages share this table; keep the ones still configured (they're re-posted by the sticky module).
  const sticky = ctx.config(guild.id).sticky;
  const liveSticky = (k: string) => sticky.enabled && sticky.messages.some((m) => k === `sticky:${m.channelId}`);
  for (const stale of existing.values()) {
    if (liveSticky(stale.key)) continue;
    await deleteOld(stale.channelId, stale.messageId);
    ctx.store.removePanel(guild.id, stale.key);
    changes++;
  }
  return changes;
}
