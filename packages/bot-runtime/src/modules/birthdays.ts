import { renderTemplate } from '@delyforge/shared';
import { type ChatInputCommandInteraction, type Guild, MessageFlags } from 'discord.js';
import { BRAND_COLOR, type ModuleContext, SAFE_MENTIONS, sendableChannel, tryDM } from './context.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const validBirthday = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;

/** Is it this person's birthday today (UTC)? 29 February is celebrated on 28 February in other years. */
export function isBirthdayToday(month: number, day: number, now: Date): boolean {
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  if (month === 2 && day === 29 && !isLeap(now.getUTCFullYear())) return m === 2 && d === 28;
  return m === month && d === day;
}

/** Who to celebrate now: birthday today, the announcement hour has come, and not yet celebrated this year. */
export function dueBirthdays(list: { userId: string; month: number; day: number; announcedYear: number | null }[], now: Date, hourUtc: number): string[] {
  if (now.getUTCHours() < hourUtc) return [];
  return list.filter((b) => b.announcedYear !== now.getUTCFullYear() && isBirthdayToday(b.month, b.day, now)).map((b) => b.userId);
}

/** Days until the next birthday (0 = today). */
export function daysUntil(month: number, day: number, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < 366; i++) {
    const d = new Date(today + i * 86_400_000);
    if (isBirthdayToday(month, day, d)) return i;
  }
  return 366;
}

/** Servers whose birthday role was cleaned up today (UTC date). */
const cleanedUp = new Map<string, string>();

/** Runs every minute: announces today's birthdays and moves the birthday role. */
export async function checkBirthdays(ctx: ModuleContext, guild: Guild, now = new Date()): Promise<void> {
  const config = ctx.config(guild.id).birthdays;
  if (!config.enabled || now.getUTCHours() < config.hourUtc) return;
  const list = ctx.store.birthdays(guild.id);
  const role = config.roleId ? guild.roles.cache.get(config.roleId) : undefined;

  // Once a day: take the birthday role back from everyone whose birthday isn't today.
  const today = now.toISOString().slice(0, 10);
  if (role && cleanedUp.get(guild.id) !== today) {
    cleanedUp.set(guild.id, today);
    for (const b of list) {
      if (b.announcedYear === null || isBirthdayToday(b.month, b.day, now)) continue;
      const m = await guild.members.fetch(b.userId).catch(() => null);
      if (m?.roles.cache.has(role.id)) await m.roles.remove(role, 'Birthday is over').catch(() => null);
    }
  }

  const due = dueBirthdays(list, now, config.hourUtc);
  if (!due.length) return;
  const channel = await sendableChannel(ctx, guild, config.channelId, 'Birthdays');
  for (const userId of due) {
    ctx.store.markBirthdayAnnounced(guild.id, userId, now.getUTCFullYear());
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue; // left the server
    if (role) await member.roles.add(role, 'Happy birthday!').catch((e: Error) => ctx.log('warn', `Birthdays: could not give the role: ${e.message}`));
    const vars = { user: `<@${userId}>`, 'user.name': member.displayName, server: guild.name };
    await channel?.send({ content: renderTemplate(config.message, vars), allowedMentions: SAFE_MENTIONS }).catch((e: Error) => ctx.log('warn', `Birthdays: could not post: ${e.message}`));
    if (config.dmMessage.trim()) await tryDM(member.user, renderTemplate(config.dmMessage, vars));
  }
}

export async function handleBirthdayCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.guild) return;
  if (!ctx.config(i.guild.id).birthdays.enabled) {
    await i.reply({ content: 'Birthdays aren’t enabled in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'set') {
    const month = i.options.getInteger('month', true);
    const day = i.options.getInteger('day', true);
    if (!validBirthday(month, day)) {
      await i.reply({ content: `${MONTHS[month - 1] ?? 'That month'} doesn’t have a day ${day}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    ctx.store.setBirthday(i.guild.id, i.user.id, month, day);
    await i.reply({ content: `🎂 Saved: **${day} ${MONTHS[month - 1]}**. We’ll celebrate you then!`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'remove') {
    const removed = ctx.store.removeBirthday(i.guild.id, i.user.id);
    await i.reply({ content: removed ? 'Your birthday was removed.' : 'You hadn’t saved a birthday.', flags: MessageFlags.Ephemeral });
    return;
  }
  const now = new Date();
  const upcoming = ctx.store
    .birthdays(i.guild.id)
    .map((b) => ({ ...b, inDays: daysUntil(b.month, b.day, now) }))
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, 10);
  await i.reply({
    embeds: [
      {
        title: '🎂 Upcoming birthdays',
        description: upcoming.length
          ? upcoming.map((b) => `<@${b.userId}> — ${b.day} ${MONTHS[b.month - 1]} ${b.inDays === 0 ? '**(today!)**' : `(in ${b.inDays} day${b.inDays === 1 ? '' : 's'})`}`).join('\n')
          : 'Nobody has saved a birthday yet. Use `/birthday set`.',
        color: BRAND_COLOR,
      },
    ],
    allowedMentions: { parse: [] },
  });
}
