import { randomInt } from 'node:crypto';
import { dailyReward, type EconomyConfig, parseAmount, robOutcome, spinSlots } from '@delyforge/shared';
import { type AutocompleteInteraction, type ChatInputCommandInteraction, type Message, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { COLORS, type ModuleContext, truncate } from './context.js';
import { assignable } from './roles.js';

/** Economy: coins per server, kept in the bot's own database. */

export const ECONOMY_COMMANDS = new Set(['beg', 'crime', 'balance', 'daily', 'work', 'pay', 'deposit', 'withdraw', 'rob', 'rich', 'shopitems', 'buy', 'inventory', 'coinflip', 'slots', 'eco']);

const roll = () => randomInt(0, 1_000_000) / 1_000_000;
const JOBS = ['delivered pizzas', 'walked some dogs', 'fixed a computer', 'streamed for a few hours', 'mowed lawns', 'washed cars', 'designed a logo', 'babysat', 'coded a website', 'sold lemonade'];

function fmt(c: EconomyConfig, n: number): string {
  return `${c.currencyEmoji ? `${c.currencyEmoji} ` : ''}**${n.toLocaleString('en-US')}** ${c.currencyName}`;
}

const say = (i: ChatInputCommandInteraction, description: string, color: number = COLORS.brand, ephemeral = false) =>
  i.reply({ embeds: [{ description, color }], allowedMentions: { parse: [] }, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
const until = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

export async function handleEconomyCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).economy;
  if (!c.enabled) return void (await say(i, 'The economy isn’t enabled in this server.', COLORS.warn, true));
  const g = i.guildId;
  const me = i.user.id;
  const start = c.startingBalance;
  const now = Date.now();
  // Role boosts (e.g. boosters 2×) for /daily, /work and /crime.
  const boost = c.payMultipliers.reduce((best, p) => (i.member.roles.cache.has(p.roleId) ? Math.max(best, p.multiplier) : best), 1);

  switch (i.commandName) {
    case 'beg': {
      ctx.store.account(g, me, start);
      const last = ctx.store.lastBegCrime(g, me).beg;
      if (last && now - last < 600_000) return void (await say(i, `Nobody’s listening. Try again ${until(last + 600_000)}.`, COLORS.warn, true));
      ctx.store.setBegCrime(g, me, 'beg', now);
      const n = randomInt(0, 4) === 0 ? 0 : randomInt(1, Math.max(2, Math.ceil(c.work.min / 4)) + 1);
      if (!n) return void (await say(i, '🙁 Someone walked right past you. No coins this time.', COLORS.warn));
      ctx.store.addCoins(g, me, n, start);
      return void (await say(i, `🥺 A kind stranger gave you ${fmt(c, n)}.`, COLORS.success));
    }
    case 'crime': {
      const wallet = ctx.store.account(g, me, start).wallet;
      const last = ctx.store.lastBegCrime(g, me).crime;
      if (last && now - last < 7_200_000) return void (await say(i, `Lie low — you can try again ${until(last + 7_200_000)}.`, COLORS.warn, true));
      ctx.store.setBegCrime(g, me, 'crime', now);
      if (randomInt(0, 100) < 45) {
        const n = Math.round(randomInt(c.work.max, c.work.max * 3 + 1) * boost);
        ctx.store.addCoins(g, me, n, start);
        return void (await say(i, `🕶️ The heist worked! You got away with ${fmt(c, n)}.`, COLORS.success));
      }
      const fine = Math.min(wallet, randomInt(c.work.min, c.work.max * 2 + 1));
      if (fine) ctx.store.addCoins(g, me, -fine, start);
      return void (await say(i, `🚔 Busted! You paid a fine of ${fmt(c, fine)}.`, COLORS.danger));
    }
    case 'balance': {
      const user = i.options.getUser('member') ?? i.user;
      if (user.bot) return void (await say(i, 'Bots don’t have wallets.', COLORS.warn, true));
      const a = ctx.store.account(g, user.id, start);
      return void (await i.reply({
        embeds: [{ author: { name: user.username, icon_url: user.displayAvatarURL({ size: 64 }) }, color: COLORS.brand, fields: [{ name: 'Wallet', value: fmt(c, a.wallet), inline: true }, { name: 'Bank', value: fmt(c, a.bank), inline: true }, { name: 'Total', value: fmt(c, a.wallet + a.bank), inline: true }] }],
        allowedMentions: { parse: [] },
      }));
    }
    case 'daily': {
      const a = ctx.store.account(g, me, start);
      const r = dailyReward(c.daily, a.lastDaily, a.streak, now);
      if (!r.ok) return void (await say(i, `You already collected today. Come back ${until(r.nextAt)}.`, COLORS.warn, true));
      const amount = Math.round(r.amount * boost);
      ctx.store.addCoins(g, me, amount, start);
      ctx.store.setEconomyTimes(g, me, { lastDaily: now, streak: r.streak });
      return void (await say(i, `📅 You collected ${fmt(c, amount)}!${r.streak > 1 ? ` 🔥 ${r.streak}-day streak.` : ''}${boost > 1 ? ` (${boost}× role bonus)` : ''}`, COLORS.success));
    }
    case 'work': {
      const a = ctx.store.account(g, me, start);
      const next = (a.lastWork ?? 0) + c.work.cooldownMinutes * 60_000;
      if (now < next) return void (await say(i, `You’re tired. You can work again ${until(next)}.`, COLORS.warn, true));
      const pay = Math.round(randomInt(c.work.min, c.work.max + 1) * boost);
      ctx.store.addCoins(g, me, pay, start);
      ctx.store.setEconomyTimes(g, me, { lastWork: now });
      return void (await say(i, `💼 You ${JOBS[randomInt(JOBS.length)]} and earned ${fmt(c, pay)}.`, COLORS.success));
    }
    case 'pay': {
      const to = i.options.getUser('member', true);
      if (to.bot || to.id === me) return void (await say(i, 'Pick someone else (not a bot).', COLORS.warn, true));
      const n = parseAmount(i.options.getString('amount', true), ctx.store.account(g, me, start).wallet);
      if (!n || !ctx.store.transferCoins(g, me, to.id, n, start)) return void (await say(i, 'You don’t have that much in your wallet.', COLORS.warn, true));
      return void (await say(i, `💸 <@${me}> gave <@${to.id}> ${fmt(c, n)}.`, COLORS.success));
    }
    case 'deposit':
    case 'withdraw': {
      const deposit = i.commandName === 'deposit';
      const a = ctx.store.account(g, me, start);
      const n = parseAmount(i.options.getString('amount', true), deposit ? a.wallet : a.bank);
      if (!n || !ctx.store.moveToBank(g, me, n, deposit, start)) return void (await say(i, `You don’t have that much ${deposit ? 'in your wallet' : 'in the bank'}.`, COLORS.warn, true));
      return void (await say(i, deposit ? `🏦 Deposited ${fmt(c, n)}.` : `🏦 Withdrew ${fmt(c, n)}.`, COLORS.success, true));
    }
    case 'rob': {
      if (!c.rob.enabled) return void (await say(i, 'Robbing is turned off here.', COLORS.warn, true));
      const victim = i.options.getUser('member', true);
      if (victim.bot || victim.id === me) return void (await say(i, 'Pick someone else (not a bot).', COLORS.warn, true));
      const a = ctx.store.account(g, me, start);
      const next = (a.lastRob ?? 0) + c.rob.cooldownMinutes * 60_000;
      if (now < next) return void (await say(i, `Lie low for a while — you can rob again ${until(next)}.`, COLORS.warn, true));
      const v = ctx.store.account(g, victim.id, start);
      if (v.wallet < Math.max(1, c.rob.minWallet)) return void (await say(i, `<@${victim.id}> doesn’t have enough in their wallet to be worth it.`, COLORS.warn, true));
      ctx.store.setEconomyTimes(g, me, { lastRob: now });
      const out = robOutcome(c.rob, a.wallet, v.wallet, roll(), roll());
      if (out.success) {
        const n = Math.min(out.amount, v.wallet);
        ctx.store.transferCoins(g, victim.id, me, n, start);
        return void (await say(i, `🦹 You robbed <@${victim.id}> and got away with ${fmt(c, n)}!`, COLORS.success));
      }
      if (out.amount > 0) ctx.store.transferCoins(g, me, victim.id, out.amount, start);
      return void (await say(i, `🚓 You got caught!${out.amount > 0 ? ` You paid <@${victim.id}> ${fmt(c, out.amount)}.` : ''}`, COLORS.danger));
    }
    case 'rich': {
      const top = ctx.store.richest(g, 10);
      if (!top.length) return void (await say(i, 'Nobody has any coins yet — try /daily!', COLORS.info, true));
      const medals = ['🥇', '🥈', '🥉'];
      return void (await i.reply({ embeds: [{ title: '💰 Richest members', description: top.map((t, n) => `${medals[n] ?? `**${n + 1}.**`} <@${t.userId}> — ${fmt(c, t.total)}`).join('\n'), color: COLORS.brand }], allowedMentions: { parse: [] } }));
    }
    case 'shopitems': {
      if (!c.shop.length) return void (await say(i, 'The coin shop is empty.', COLORS.info, true));
      return void (await i.reply({
        embeds: [{ title: '🛍️ Coin shop', description: c.shop.map((s) => `**${s.name}** — ${fmt(c, s.price)}${s.roleId ? ` · gives <@&${s.roleId}>` : ''}${s.description ? `\n-# ${s.description}` : ''}`).join('\n'), footer: { text: 'Buy with /buy' }, color: COLORS.brand }],
        allowedMentions: { parse: [] },
      }));
    }
    case 'buy': {
      const typed = i.options.getString('item', true);
      const item = c.shop.find((s) => s.id === typed) ?? c.shop.find((s) => s.name.toLowerCase() === typed.trim().toLowerCase());
      if (!item) return void (await say(i, 'That isn’t in the shop — see /shopitems.', COLORS.warn, true));
      if (item.roleId) {
        if (i.member.roles.cache.has(item.roleId)) return void (await say(i, 'You already have that role.', COLORS.warn, true));
        if (!assignable(i.member, [item.roleId]).length) return void (await say(i, 'I can’t give that role — ask staff to move my role above it.', COLORS.warn, true));
      }
      if (!ctx.store.addCoins(g, me, -item.price, start)) return void (await say(i, `You need ${fmt(c, item.price)} in your wallet.`, COLORS.warn, true));
      if (item.roleId) {
        const given = await i.member.roles.add(item.roleId, `Bought “${item.name}” in the coin shop`).then(() => true, () => false);
        if (!given) {
          ctx.store.addCoins(g, me, item.price, start); // refund
          return void (await say(i, 'I couldn’t give you the role, so you weren’t charged.', COLORS.warn, true));
        }
      }
      ctx.store.addItem(g, me, item.id);
      return void (await say(i, `🛍️ You bought **${item.name}** for ${fmt(c, item.price)}.`, COLORS.success));
    }
    case 'inventory': {
      const user = i.options.getUser('member') ?? i.user;
      const owned = ctx.store.items(g, user.id).map((x) => ({ ...x, item: c.shop.find((s) => s.id === x.itemId) })).filter((x) => x.item);
      if (!owned.length) return void (await say(i, `<@${user.id}> hasn’t bought anything yet.`, COLORS.info, true));
      return void (await i.reply({ embeds: [{ title: `🎒 ${user.username}’s items`, description: owned.map((x) => `**${x.item!.name}** × ${x.count}`).join('\n'), color: COLORS.brand }], allowedMentions: { parse: [] } }));
    }
    case 'coinflip':
    case 'slots': {
      if (!c.gambling.enabled) return void (await say(i, 'Gambling is turned off here.', COLORS.warn, true));
      const wallet = ctx.store.account(g, me, start).wallet;
      const bet = parseAmount(i.options.getString('amount', true), Math.min(wallet, c.gambling.maxBet));
      if (!bet || bet > wallet) return void (await say(i, 'You don’t have that much in your wallet.', COLORS.warn, true));
      if (bet > c.gambling.maxBet) return void (await say(i, `The most you can bet is ${fmt(c, c.gambling.maxBet)}.`, COLORS.warn, true));
      if (!ctx.store.addCoins(g, me, -bet, start)) return void (await say(i, 'You don’t have that much in your wallet.', COLORS.warn, true));
      if (i.commandName === 'coinflip') {
        const side = randomInt(2) === 0 ? 'heads' : 'tails';
        const won = side === i.options.getString('side', true);
        if (won) ctx.store.addCoins(g, me, bet * 2, start);
        return void (await say(i, `🪙 It’s **${side}**! ${won ? `You won ${fmt(c, bet)}.` : `You lost ${fmt(c, bet)}.`}`, won ? COLORS.success : COLORS.danger));
      }
      const s = spinSlots([roll(), roll(), roll()], bet);
      if (s.payout) ctx.store.addCoins(g, me, s.payout, start);
      return void (await say(i, `🎰 | ${s.reels.join(' | ')} |\n${s.payout ? `You won ${fmt(c, s.payout - bet)}!` : `You lost ${fmt(c, bet)}.`}`, s.payout ? COLORS.success : COLORS.danger));
    }
    case 'eco': {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) return void (await say(i, 'Only staff with Manage Server can do that.', COLORS.warn, true));
      const user = i.options.getUser('member', true);
      if (user.bot) return void (await say(i, 'Bots don’t have wallets.', COLORS.warn, true));
      const sub = i.options.getSubcommand();
      if (sub === 'reset') {
        ctx.store.resetEconomy(g, user.id);
        return void (await say(i, `Reset <@${user.id}>’s coins and items.`, COLORS.success, true));
      }
      const n = i.options.getInteger('amount', true);
      if (sub === 'set') ctx.store.setWallet(g, user.id, n, start);
      else if (sub === 'give') ctx.store.addCoins(g, user.id, n, start);
      else if (!ctx.store.addCoins(g, user.id, -n, start)) ctx.store.setWallet(g, user.id, 0, start); // take: never below zero
      ctx.log('info', `Economy: ${i.user.tag} used /eco ${sub} ${n} on ${user.tag}.`);
      return void (await say(i, `<@${user.id}> now has ${fmt(c, ctx.store.account(g, user.id, start).wallet)} in their wallet.`, COLORS.success, true));
    }
  }
}

/** Suggestions while typing /buy. */
export async function onBuyAutocomplete(ctx: ModuleContext, i: AutocompleteInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).economy;
  const q = i.options.getFocused().toLowerCase();
  await i.respond(c.shop.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 25).map((s) => ({ name: truncate(`${s.name} — ${s.price.toLocaleString('en-US')} ${c.currencyName}`, 100), value: s.id }))).catch(() => null);
}

/** Once a day (checked every 10 minutes): bank interest. */
export function payInterest(ctx: ModuleContext, guildId: string, now = Date.now()): void {
  const c = ctx.config(guildId).economy;
  if (!c.enabled || !c.interestPercent) return;
  if (ctx.store.bumpShopCount(guildId, `eco-interest:${new Date(now).toISOString().slice(0, 10)}`) !== 1) return;
  const n = ctx.store.applyInterest(guildId, c.interestPercent);
  if (n) ctx.log('info', `Economy: paid ${c.interestPercent}% bank interest to ${n} member(s).`);
}

/** Coins for chatting, at most once per cooldown per member. */
export function onMessageCoins(ctx: ModuleContext, m: Message): void {
  if (!m.inGuild() || m.author.bot) return;
  const c = ctx.config(m.guild.id).economy;
  if (!c.enabled || !c.chat.enabled || c.chat.max <= 0) return;
  const a = ctx.store.account(m.guild.id, m.author.id, c.startingBalance);
  const now = Date.now();
  if (a.lastChat && now - a.lastChat < c.chat.cooldownSeconds * 1000) return;
  ctx.store.setEconomyTimes(m.guild.id, m.author.id, { lastChat: now });
  ctx.store.addCoins(m.guild.id, m.author.id, randomInt(c.chat.min, c.chat.max + 1), c.startingBalance);
}
