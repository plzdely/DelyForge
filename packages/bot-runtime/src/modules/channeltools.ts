import { channelRuleProblem, renderTemplate } from '@delyforge/shared';
import { ChannelType, type Message, PermissionFlagsBits } from 'discord.js';
import { type ModuleContext, templateVars, tryDM } from './context.js';

/** Channel automation: the rules set for the channel a message was posted in. Staff (Manage Messages) skip the limits. */
export async function onChannelRuleMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot || m.channel.isThread()) return;
  const c = ctx.config(m.guild.id).channelTools;
  const rule = c.enabled ? c.rules.find((r) => r.channelId === m.channelId) : undefined;
  if (!rule) return;
  const staff = m.member?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false;

  const remove = async (why: string) => {
    await m.delete().catch(() => null);
    if (rule.notify) await tryDM(m.author, `Your message in #${m.channel.isTextBased() && 'name' in m.channel ? m.channel.name : 'a channel'} (${m.guild.name}) was removed: ${why}.`);
  };
  if (!staff) {
    const problem = channelRuleProblem(rule.only, { text: m.content, attachments: m.attachments.size });
    if (problem) return void (await remove(problem));
    if (rule.postCooldownMinutes && ctx.store.tooSoonInChannel(m.channelId, m.author.id, rule.postCooldownMinutes * 60_000, Date.now())) {
      return void (await remove(`you can post there once every ${rule.postCooldownMinutes >= 60 ? `${Math.round(rule.postCooldownMinutes / 60)} hour(s)` : `${rule.postCooldownMinutes} minute(s)`}`));
    }
  }

  if (rule.autoPublish && m.channel.type === ChannelType.GuildAnnouncement && m.crosspostable) await m.crosspost().catch((e: Error) => ctx.log('warn', `Channel automation: couldn’t publish: ${e.message}`));
  for (const emoji of rule.reactions) await m.react(emoji).catch(() => null);
  if (rule.autoThread && m.member) {
    const name = renderTemplate(rule.threadName, templateVars(m.member)).slice(0, 100) || 'Discussion';
    await m.startThread({ name }).catch((e: Error) => ctx.log('warn', `Channel automation: couldn’t open a thread: ${e.message}`));
  }
  // shortcut: the timer is lost if the bot restarts before it fires (fine for up to 24 h; store it if that matters).
  if (rule.deleteAfterSeconds && !m.pinned) setTimeout(() => void m.delete().catch(() => null), rule.deleteAfterSeconds * 1000);
}
