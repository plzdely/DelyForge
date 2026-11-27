import { randomInt } from 'node:crypto';
import { matchTrigger, renderTemplate } from '@delyforge/shared';
import type { Message } from 'discord.js';
import { type ModuleContext, SAFE_MENTIONS, hexToInt, templateVars, truncate } from './context.js';

/** Last time each responder fired per channel (for its cooldown). */
const lastFired = new Map<string, number>();

/** Auto-responder: the first matching responder answers (one per message, so a message can't set off a chain). */
export async function onAutoRespond(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot || !m.member || !m.content) return;
  const c = ctx.config(m.guild.id).autoResponder;
  if (!c.enabled || !c.responders.length) return;
  const channelId = m.channel.isThread() ? (m.channel.parentId ?? m.channelId) : m.channelId;
  for (const r of c.responders) {
    if (r.channelIds.length && !r.channelIds.includes(channelId)) continue;
    if (m.member.roles.cache.some((role) => r.ignoredRoleIds.includes(role.id))) continue;
    if (r.requiredRoleIds.length && !m.member.roles.cache.some((role) => r.requiredRoleIds.includes(role.id))) continue;
    const args = matchTrigger(m.content, r);
    if (args === null) continue;
    const key = `${m.guild.id}:${r.id}:${m.channelId}`;
    if (r.cooldownSeconds && Date.now() - (lastFired.get(key) ?? 0) < r.cooldownSeconds * 1000) return;
    lastFired.set(key, Date.now());
    if (lastFired.size > 5000) lastFired.clear();

    if (r.react) await m.react(r.react).catch(() => ctx.log('warn', `Auto-responder: couldn’t react with “${r.react}” (unknown emoji?).`));
    const options = r.responses.filter((x) => x.trim());
    if (options.length) {
      const text = truncate(renderTemplate(options[randomInt(options.length)]!, { ...templateVars(m.member), channel: `<#${m.channelId}>`, args: args || '' }), 2000);
      const payload = r.embed ? { embeds: [{ description: text, color: hexToInt(r.color) }], allowedMentions: SAFE_MENTIONS } : { content: text, allowedMentions: SAFE_MENTIONS };
      if (r.dm) await m.author.send(payload).catch(() => null);
      else if (r.reply && !r.deleteTrigger) await m.reply(payload).catch(() => null);
      else await m.channel.send(payload).catch((e: Error) => ctx.log('warn', `Auto-responder: couldn’t answer in #${'name' in m.channel ? m.channel.name : 'channel'}: ${e.message}`));
    }
    if (r.deleteTrigger) await m.delete().catch(() => null);
    return;
  }
}
