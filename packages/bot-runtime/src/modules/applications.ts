import { type ApplicationForm, renderTemplate } from '@delyforge/shared';
import { type ButtonInteraction, ButtonStyle, ComponentType, type GuildMember, MessageFlags, type ModalSubmitInteraction, TextInputStyle } from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, truncate } from './context.js';
import { assignable, isStaff } from './roles.js';

/** Applications: a panel button opens a form; answers go to a review channel with Accept / Deny. */

export const APP_CID = {
  open: (formId: string) => `df:app:open:${formId}`,
  submit: (formId: string) => `df:app:submit:${formId}`,
  accept: (id: number) => `df:app:accept:${id}`,
  deny: (id: number) => `df:app:deny:${id}`,
  reason: (id: number) => `df:app:reason:${id}`,
} as const;

type Reply = ButtonInteraction | ModalSubmitInteraction;
const ephemeral = (i: Reply, content: string) =>
  i.replied || i.deferred ? i.editReply({ content, allowedMentions: { parse: [] } }) : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Why this member can't apply right now (pending application, or the cooldown after a decision), or null. */
export function applyBlocked(last: { status: string; decidedAt: number | null } | null, cooldownHours: number, now: number): string | null {
  if (!last) return null;
  if (last.status === 'pending') return 'You already have an application waiting for a decision.';
  if (cooldownHours && last.decidedAt && now - last.decidedAt < cooldownHours * 3_600_000) {
    return `You can apply again <t:${Math.floor((last.decidedAt + cooldownHours * 3_600_000) / 1000)}:R>.`;
  }
  return null;
}

/** Members submitting right now — a double submit must not create two applications. */
const submitting = new Set<string>();

function formOf(ctx: ModuleContext, guildId: string, formId: string): ApplicationForm | null {
  const c = ctx.config(guildId).applications;
  return c.enabled ? (c.forms.find((f) => f.id === formId) ?? null) : null;
}

/** Panel button: show the form. */
export async function onApplyOpen(ctx: ModuleContext, i: ButtonInteraction, formId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const form = formOf(ctx, i.guildId, formId);
  if (!form || !form.reviewChannelId) return void (await ephemeral(i, 'This application is closed right now.'));
  const blocked = applyBlocked(ctx.store.lastApplication(i.guildId, formId, i.user.id), form.cooldownHours, Date.now());
  if (blocked) return void (await ephemeral(i, blocked));
  await i.showModal({
    title: truncate(`${form.name} application`, 45),
    custom_id: APP_CID.submit(formId),
    components: form.questions.map((q, n) => ({
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.TextInput, custom_id: `q${n}`, label: q.label, style: q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph, required: q.required, max_length: q.style === 'short' ? 200 : 1000 }],
    })),
  });
}

/** The form was sent: save it and post it for review. */
export async function onApplySubmit(ctx: ModuleContext, i: ModalSubmitInteraction, formId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const form = formOf(ctx, i.guildId, formId);
  if (!form) return void (await ephemeral(i, 'This application is closed right now.'));
  const key = `${i.guildId}:${formId}:${i.user.id}`;
  if (submitting.has(key)) return void (await ephemeral(i, 'Your application is being sent — one moment.'));
  submitting.add(key);
  try {
    const blocked = applyBlocked(ctx.store.lastApplication(i.guildId, formId, i.user.id), form.cooldownHours, Date.now());
    if (blocked) return void (await ephemeral(i, blocked));
    const channel = await sendableChannel(ctx, i.guild, form.reviewChannelId, `Applications (${form.name})`);
    if (!channel) return void (await ephemeral(i, 'Applications can’t be received right now — please tell staff.'));
    const answers = form.questions.map((q, n) => ({ q: q.label, a: i.fields.getTextInputValue(`q${n}`).trim() || '—' }));
    const id = ctx.store.addApplication({ guildId: i.guildId, formId, userId: i.user.id, answers }, Date.now());
    const msg = await channel
      .send({
        embeds: [
          {
            title: `${form.name} application #${id}`,
            author: { name: i.user.tag, icon_url: i.user.displayAvatarURL({ size: 64 }) },
            description: `<@${i.user.id}> · account made <t:${Math.floor(i.user.createdTimestamp / 1000)}:R>${i.member.joinedTimestamp ? ` · joined <t:${Math.floor(i.member.joinedTimestamp / 1000)}:R>` : ''}`,
            fields: answers.map((x) => ({ name: truncate(x.q, 256), value: truncate(x.a, 1024) })),
            color: COLORS.info,
            timestamp: new Date().toISOString(),
          },
        ],
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              { type: ComponentType.Button, style: ButtonStyle.Success, label: 'Accept', custom_id: APP_CID.accept(id) },
              { type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Deny', custom_id: APP_CID.deny(id) },
            ],
          },
        ],
        allowedMentions: { parse: [] },
      })
      .catch((e: Error) => (ctx.log('warn', `Applications: could not post #${id}: ${e.message}`), null));
    if (msg && form.thread) await msg.startThread({ name: truncate(`${i.user.username} — ${form.name}`, 100) }).catch(() => null);
    ctx.log('info', `Applications: ${i.user.tag} applied for ${form.name} (#${id}).`);
    await ephemeral(i, `✅ Your ${form.name} application was sent. You’ll get a DM when staff decide.`);
  } finally {
    submitting.delete(key);
  }
}

function canReview(member: GuildMember, form: ApplicationForm): boolean {
  return isStaff(member, form.reviewerRoleIds);
}

/** Accept (straight away) or Deny (asks for an optional reason first). */
export async function onApplyDecision(ctx: ModuleContext, i: ButtonInteraction, id: number, accept: boolean): Promise<void> {
  if (!i.inCachedGuild()) return;
  const app = ctx.store.application(id);
  const form = app && app.guildId === i.guildId ? formOf(ctx, i.guildId, app.formId) : null;
  if (!app || !form) return void (await ephemeral(i, 'This application no longer exists.'));
  if (!canReview(i.member, form)) return void (await ephemeral(i, 'Only reviewers can decide applications.'));
  if (app.status !== 'pending') return void (await ephemeral(i, `This application was already ${app.status}.`));
  if (!accept) {
    return void (await i.showModal({
      title: 'Deny application',
      custom_id: APP_CID.reason(id),
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.TextInput, custom_id: 'reason', label: 'Reason (sent to them; optional)', style: TextInputStyle.Paragraph, required: false, max_length: 500 }] }],
    }));
  }
  await decide(ctx, i, id, form, true, '');
}

export async function onApplyDenyReason(ctx: ModuleContext, i: ModalSubmitInteraction, id: number): Promise<void> {
  if (!i.inCachedGuild()) return;
  const app = ctx.store.application(id);
  const form = app && app.guildId === i.guildId ? formOf(ctx, i.guildId, app.formId) : null;
  if (!app || !form || !canReview(i.member, form)) return void (await ephemeral(i, 'You can’t decide this application.'));
  await decide(ctx, i, id, form, false, i.fields.getTextInputValue('reason').trim());
}

async function decide(ctx: ModuleContext, i: (ButtonInteraction | ModalSubmitInteraction) & { guild: NonNullable<ButtonInteraction['guild']>; member: GuildMember }, id: number, form: ApplicationForm, accept: boolean, reason: string): Promise<void> {
  if (!ctx.store.decideApplication(id, accept ? 'accepted' : 'denied', i.user.id, Date.now())) return void (await ephemeral(i, 'Someone already decided this application.'));
  const app = ctx.store.application(id)!;
  const member = await i.guild.members.fetch(app.userId).catch(() => null);
  let roleNote = '';
  if (accept && member) {
    const add = assignable(member, form.acceptRoleId ? [form.acceptRoleId] : []);
    const remove = assignable(member, form.removeRoleId ? [form.removeRoleId] : []);
    if (add.length) await member.roles.add(add, `Application #${id} accepted`).catch((e: Error) => (roleNote = ` (role not given: ${e.message})`));
    else if (form.acceptRoleId) roleNote = ' (I can’t give that role — move my role above it)';
    if (remove.length) await member.roles.remove(remove, `Application #${id} accepted`).catch(() => null);
  }
  const vars = { user: `<@${app.userId}>`, 'user.name': member?.displayName ?? 'there', server: i.guild.name, reason: reason || 'No reason given' };
  const text = renderTemplate(accept ? form.acceptMessage : form.denyMessage, vars);
  const dm = member ? await member.send({ embeds: [{ title: `${form.name} application — ${accept ? 'accepted ✅' : 'denied'}`, description: `${text}${!accept && reason ? `\n\n**Reason:** ${reason}` : ''}`, color: accept ? COLORS.success : COLORS.danger, footer: { text: i.guild.name } }] }).then(() => true, () => false) : false;

  const embed = i.message?.embeds[0];
  const verdict = { name: accept ? '✅ Accepted' : '❌ Denied', value: `by <@${i.user.id}>${reason ? ` — ${truncate(reason, 900)}` : ''}${roleNote}${dm ? '' : ' · couldn’t DM them'}` };
  const update = { embeds: embed ? [{ ...embed.toJSON(), color: accept ? COLORS.success : COLORS.danger, fields: [...(embed.fields ?? []), verdict] }] : [], components: [] };
  if (i.isButton()) await i.update(update);
  else if (i.isFromMessage()) await i.update(update);
  else await ephemeral(i, 'Done.');
  ctx.log('info', `Applications: #${id} ${accept ? 'accepted' : 'denied'} by ${i.user.tag}.`);
}
