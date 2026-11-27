import { type GuildInfo, type ModuleConfigs, RESPONDER_VARIABLES } from '@delyforge/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RoleValueRows, Section, TemplateField } from './fields';
import { ColorField } from './forms';
import { ChannelChecklist, ChannelSelect, NumberField, RoleChecklist, ToggleRow } from './pickers';

type Props<K extends keyof ModuleConfigs> = { c: ModuleConfigs[K]; set: (c: ModuleConfigs[K]) => void; guild: GuildInfo };

const nextId = (prefix: string, taken: readonly string[]) => {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── Auto-responder ───────────────────────────────────────────────────────────────────────────────────────────────

export function AutoResponderForm({ c, set, guild }: Props<'autoResponder'>) {
  type R = (typeof c.responders)[number];
  const update = (n: number, patch: Partial<R>) => set({ ...c, responders: c.responders.map((r, i) => (i === n ? { ...r, ...patch } : r)) });
  return (
    <>
      <p className="px-1 text-xs text-fg-subtle">The first responder that matches a message answers (one per message). Needs Message Content Intent in the Developer Portal.</p>
      {c.responders.map((r, n) => (
        <Card key={r.id} className="space-y-3 p-5">
          <div className="grid grid-cols-[1fr_11rem_auto] items-end gap-2">
            <Field label="When someone says" htmlFor={`ar-t-${r.id}`}>
              <Input id={`ar-t-${r.id}`} maxLength={100} value={r.trigger} onChange={(e) => update(n, { trigger: e.target.value })} placeholder="e.g. how do i apply" />
            </Field>
            <Field label="Match" htmlFor={`ar-m-${r.id}`}>
              <Select id={`ar-m-${r.id}`} value={r.match} onChange={(e) => update(n, { match: e.target.value as R['match'] })}>
                <option value="contains">Anywhere in the message</option>
                <option value="word">As a whole word</option>
                <option value="startsWith">At the start</option>
                <option value="exact">The whole message</option>
              </Select>
            </Field>
            <Button size="icon" variant="ghost" aria-label={`Remove responder ${r.trigger}`} onClick={() => set({ ...c, responders: c.responders.filter((_, i) => i !== n) })}>
              <Trash2 />
            </Button>
          </div>
          {r.responses.map((text, k) => (
            <div key={k} className="flex items-start gap-2">
              <div className="flex-1">
                <TemplateField id={`ar-r-${r.id}-${k}`} label={k ? `Or this answer (picked at random)` : 'Answer'} max={2000} value={text} onChange={(v) => update(n, { responses: r.responses.map((x, j) => (j === k ? v : x)) })} variables={RESPONDER_VARIABLES} />
              </div>
              {r.responses.length > 1 ? (
                <Button size="icon" variant="ghost" className="mt-6" aria-label="Remove this answer" onClick={() => update(n, { responses: r.responses.filter((_, j) => j !== k) })}>
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
          {r.responses.length < 10 ? (
            <Button size="sm" variant="ghost" onClick={() => update(n, { responses: [...r.responses, ''] })}>
              <Plus /> Add another answer
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-x-6">
            <ToggleRow title="Reply to the message" checked={r.reply} onChange={(v) => update(n, { reply: v })} />
            <ToggleRow title="Send by DM instead" checked={r.dm} onChange={(v) => update(n, { dm: v })} />
            <ToggleRow title="Show as a card" checked={r.embed} onChange={(v) => update(n, { embed: v })} />
            <ToggleRow title="Delete their message" checked={r.deleteTrigger} onChange={(v) => update(n, { deleteTrigger: v })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Also react with" htmlFor={`ar-react-${r.id}`} hint="An emoji, or leave empty.">
              <Input id={`ar-react-${r.id}`} maxLength={64} value={r.react} onChange={(e) => update(n, { react: e.target.value })} />
            </Field>
            <NumberField id={`ar-cd-${r.id}`} label="Cooldown" suffix="seconds per channel" min={0} max={86_400} value={r.cooldownSeconds} onChange={(v) => update(n, { cooldownSeconds: v })} />
            {r.embed ? <ColorField id={`ar-color-${r.id}`} value={r.color} onChange={(v) => update(n, { color: v })} /> : null}
          </div>
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer text-fg-muted">Limit where and for whom it works</summary>
            <div className="mt-3 space-y-3">
              <Field label="Only in these channels (none ticked = everywhere)" htmlFor={`ar-ch-${r.id}`}>
                <ChannelChecklist guild={guild} value={r.channelIds} onChange={(ids) => update(n, { channelIds: ids.slice(0, 25) })} />
              </Field>
              <Field label="Only for members with one of these roles (none = everyone)" htmlFor={`ar-req-${r.id}`}>
                <RoleChecklist guild={guild} value={r.requiredRoleIds} onChange={(ids) => update(n, { requiredRoleIds: ids })} />
              </Field>
              <Field label="Never for these roles" htmlFor={`ar-ign-${r.id}`}>
                <RoleChecklist guild={guild} value={r.ignoredRoleIds} onChange={(ids) => update(n, { ignoredRoleIds: ids })} />
              </Field>
            </div>
          </details>
        </Card>
      ))}
      {c.responders.length < 50 ? (
        <Button
          onClick={() =>
            set({
              ...c,
              responders: [
                ...c.responders,
                { id: nextId('r', c.responders.map((r) => r.id)), trigger: 'how do i apply', match: 'contains', responses: ['Hi {user}! You can apply in the applications channel. 📝'], reply: true, embed: false, color: '#7c5cff', react: '', deleteTrigger: false, dm: false, channelIds: [], ignoredRoleIds: [], requiredRoleIds: [], cooldownSeconds: 30 },
              ],
            })
          }
        >
          <Plus /> Add an auto-response
        </Button>
      ) : null}
    </>
  );
}

// ─── Confessions ──────────────────────────────────────────────────────────────────────────────────────────────────

export function ConfessionsForm({ c, set, guild }: Props<'confessions'>) {
  return (
    <>
      <Section title="Confessions" description="Members use /confess (with an optional image). Posts are numbered and show no name.">
        <ChannelSelect id="conf-ch" label="Post confessions in" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Title" htmlFor="conf-title">
            <Input id="conf-title" maxLength={60} value={c.title} onChange={(e) => set({ ...c, title: e.target.value })} />
          </Field>
          <ColorField id="conf-color" value={c.color} onChange={(v) => set({ ...c, color: v })} />
        </div>
        <NumberField id="conf-cd" label="Wait between confessions" suffix="minutes" min={0} max={1440} value={c.cooldownMinutes} onChange={(v) => set({ ...c, cooldownMinutes: v })} />
        <ToggleRow title="Anonymous replies" description="A “Reply anonymously” button that answers in a thread under the confession." checked={c.replies} onChange={(v) => set({ ...c, replies: v })} />
      </Section>
      <Section title="Staff safety" description="Anonymous for members — but staff need a way to handle threats or abuse. Staff can also /confessions ban someone.">
        <ChannelSelect id="conf-review" label="Approve confessions first in" emptyLabel="Post straight away" hint="A staff channel with Post it / Reject buttons." guild={guild} value={c.reviewChannelId} onChange={(v) => set({ ...c, reviewChannelId: v })} />
        <ChannelSelect id="conf-log" label="Staff-only log of who sent what" emptyLabel="No log" hint="Members are told staff can see this when they confess. Keep this channel private." guild={guild} value={c.logChannelId} onChange={(v) => set({ ...c, logChannelId: v })} />
      </Section>
    </>
  );
}

// ─── Highlights ───────────────────────────────────────────────────────────────────────────────────────────────────

export function HighlightsForm({ c, set, guild }: Props<'highlights'>) {
  return (
    <>
      <Section title="Highlights" description="Members add words with /highlight add. When someone says one in a channel they can see (and they weren’t chatting there in the last 5 minutes), they get a DM with a link and the messages around it. Needs Message Content Intent.">
        <div className="grid grid-cols-2 gap-3">
          <NumberField id="hl-max" label="Words per member" min={1} max={25} value={c.maxWords} onChange={(v) => set({ ...c, maxWords: v })} />
          <NumberField id="hl-cd" label="At most one DM every" suffix="minutes" min={1} max={60} value={c.cooldownMinutes} onChange={(v) => set({ ...c, cooldownMinutes: v })} />
        </div>
      </Section>
      <Section title="Ignored channels" description="Never sends highlights from these channels. Members can also ignore channels themselves with /highlight ignore.">
        <ChannelChecklist guild={guild} value={c.ignoredChannelIds} onChange={(ids) => set({ ...c, ignoredChannelIds: ids })} />
      </Section>
    </>
  );
}

// ─── Channel automation ───────────────────────────────────────────────────────────────────────────────────────────

export function ChannelToolsForm({ c, set, guild }: Props<'channelTools'>) {
  type Rule = (typeof c.rules)[number];
  const update = (n: number, patch: Partial<Rule>) => set({ ...c, rules: c.rules.map((r, i) => (i === n ? { ...r, ...patch } : r)) });
  const free = guild.channels.filter((ch) => (ch.kind === 'text' || ch.kind === 'announcement') && !c.rules.some((r) => r.channelId === ch.id));
  return (
    <>
      <p className="px-1 text-xs text-fg-subtle">Rules for single channels. Staff with Manage Messages skip the limits. Needs Message Content Intent.</p>
      {c.rules.map((r, n) => {
        const isNews = guild.channels.find((ch) => ch.id === r.channelId)?.kind === 'announcement';
        return (
          <Card key={r.channelId} className="space-y-3 p-5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <ChannelSelect id={`ct-ch-${n}`} label="Channel" guild={guild} value={r.channelId} onChange={(v) => v && update(n, { channelId: v })} />
              </div>
              <Button size="icon" variant="ghost" aria-label="Remove this channel’s rules" onClick={() => set({ ...c, rules: c.rules.filter((_, i) => i !== n) })}>
                <Trash2 />
              </Button>
            </div>
            <Field label="Messages must be" htmlFor={`ct-only-${n}`}>
              <Select id={`ct-only-${n}`} value={r.only} onChange={(e) => update(n, { only: e.target.value as Rule['only'] })}>
                <option value="any">Anything</option>
                <option value="media">Images, videos or files (media-only channel)</option>
                <option value="text">Text only (no files)</option>
                <option value="links">Messages with a link</option>
              </Select>
            </Field>
            {isNews ? <ToggleRow title="Auto-publish" description="Publish every message to servers that follow this announcement channel." checked={r.autoPublish} onChange={(v) => update(n, { autoPublish: v })} /> : null}
            <ToggleRow title="Open a thread on every message" description="Great for showcases, suggestions or feedback." checked={r.autoThread} onChange={(v) => update(n, { autoThread: v })} />
            {r.autoThread ? (
              <Field label="Thread name" htmlFor={`ct-tn-${n}`} hint="{user.name} is the poster’s name.">
                <Input id={`ct-tn-${n}`} maxLength={90} value={r.threadName} onChange={(e) => update(n, { threadName: e.target.value })} />
              </Field>
            ) : null}
            <Field label="React to every message with" htmlFor={`ct-re-${n}`} hint="Up to 5 emojis separated by spaces, e.g. 👍 👎">
              <Input id={`ct-re-${n}`} value={r.reactions.join(' ')} onChange={(e) => update(n, { reactions: e.target.value.split(/\s+/).filter(Boolean).slice(0, 5) })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField id={`ct-del-${n}`} label="Delete messages after" suffix="seconds (0 = keep)" min={0} max={86_400} value={r.deleteAfterSeconds} onChange={(v) => update(n, { deleteAfterSeconds: v })} />
              <NumberField id={`ct-cd-${n}`} label="One post per member every" suffix="minutes (0 = no limit)" min={0} max={10_080} value={r.postCooldownMinutes} onChange={(v) => update(n, { postCooldownMinutes: v })} />
            </div>
            <ToggleRow title="Tell members why" description="DM people whose message was removed by these rules." checked={r.notify} onChange={(v) => update(n, { notify: v })} />
          </Card>
        );
      })}
      {c.rules.length < 25 && free.length ? (
        <Button onClick={() => set({ ...c, rules: [...c.rules, { channelId: free[0]!.id, autoPublish: free[0]!.kind === 'announcement', autoThread: false, threadName: '{user.name}’s post', reactions: [], only: 'any', deleteAfterSeconds: 0, postCooldownMinutes: 0, notify: true }] })}>
          <Plus /> Add a channel
        </Button>
      ) : null}
    </>
  );
}

// ─── Activity stats ───────────────────────────────────────────────────────────────────────────────────────────────

export function ActivityForm({ c, set, guild }: Props<'activity'>) {
  return (
    <>
      <Section title="Activity stats" description="Counts messages and voice minutes (with at least one other person, not deafened) per member per day. Members see them with /activity, /topchatters, /topvoice and /serveractivity.">
        <Field label="Don’t count these channels" htmlFor="act-ign">
          <ChannelChecklist guild={guild} value={c.ignoredChannelIds} onChange={(ids) => set({ ...c, ignoredChannelIds: ids })} />
        </Field>
      </Section>
      <Section title="Weekly report" description="Top chatters, most time in voice and the week’s totals, posted once a week.">
        <ChannelSelect id="act-rep" label="Post the report in" emptyLabel="No weekly report" guild={guild} value={c.report.channelId} onChange={(v) => set({ ...c, report: { ...c.report, channelId: v } })} />
        {c.report.channelId ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="On" htmlFor="act-day">
              <Select id="act-day" value={String(c.report.day)} onChange={(e) => set({ ...c, report: { ...c.report, day: Number(e.target.value) } })}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <NumberField id="act-hour" label="At" suffix=":00 UTC" min={0} max={23} value={c.report.hourUtc} onChange={(v) => set({ ...c, report: { ...c.report, hourUtc: v } })} />
          </div>
        ) : null}
      </Section>
    </>
  );
}

// ─── Reputation ───────────────────────────────────────────────────────────────────────────────────────────────────

export function ReputationForm({ c, set, guild }: Props<'reputation'>) {
  return (
    <>
      <Section title="Reputation" description="Members give a point with /rep give, see it with /rep check and /rep top. Staff can /rep set.">
        <NumberField id="rep-cd" label="Each member can give rep every" suffix="hours" min={1} max={168} value={c.cooldownHours} onChange={(v) => set({ ...c, cooldownHours: v })} />
        <ToggleRow title="“Thanks @name” counts" description="Saying thanks while mentioning someone gives them a point (needs Message Content Intent). The bot reacts ⭐." checked={c.thanks} onChange={(v) => set({ ...c, thanks: v })} />
        <ChannelSelect id="rep-log" label="Log rep in" emptyLabel="No log" guild={guild} value={c.logChannelId} onChange={(v) => set({ ...c, logChannelId: v })} />
      </Section>
      <Section title="Rep rewards" description="Roles members get when they reach a number of rep points.">
        <RoleValueRows id="rep-rewards" guild={guild} assignableOnly rows={c.rewards.map((r) => ({ roleId: r.roleId, value: r.reps }))} onChange={(rows) => set({ ...c, rewards: rows.map((r) => ({ roleId: r.roleId, reps: r.value })) })} valueLabel="At rep" min={1} max={100_000} addLabel="Add a reward" maxRows={10} defaultValue={10} />
      </Section>
    </>
  );
}

// ─── Member tools ─────────────────────────────────────────────────────────────────────────────────────────────────

export function MemberToolsForm({ c, set, guild }: Props<'memberTools'>) {
  return (
    <>
      <Section title="When someone rejoins" description="The bot remembers members’ roles and nickname when they leave. Needs Server Members Intent.">
        <ToggleRow title="Give their roles back" description="Stops people leaving and rejoining to shake off a punishment role. Staff roles (ban, kick, manage… permissions) are never given back automatically." checked={c.stickyRoles} onChange={(v) => set({ ...c, stickyRoles: v })} />
        <ToggleRow title="Give their nickname back" checked={c.stickyNickname} onChange={(v) => set({ ...c, stickyNickname: v })} />
        {c.stickyRoles ? (
          <Field label="Never give back these roles" htmlFor="mt-ex">
            <RoleChecklist guild={guild} value={c.excludedRoleIds} onChange={(ids) => set({ ...c, excludedRoleIds: ids })} />
          </Field>
        ) : null}
        <ToggleRow title="Welcome-back message" description="Sent instead of the normal welcome. {left} shows when they left." checked={c.welcomeBack.enabled} onChange={(v) => set({ ...c, welcomeBack: { ...c.welcomeBack, enabled: v } })} />
        {c.welcomeBack.enabled ? (
          <>
            <ChannelSelect id="mt-wb-ch" label="Channel" guild={guild} value={c.welcomeBack.channelId} onChange={(v) => set({ ...c, welcomeBack: { ...c.welcomeBack, channelId: v } })} />
            <TemplateField id="mt-wb-msg" label="Message" max={1000} value={c.welcomeBack.message} onChange={(v) => set({ ...c, welcomeBack: { ...c.welcomeBack, message: v } })} />
          </>
        ) : null}
      </Section>
      <Section title="Roles for time in the server" description="E.g. “Regular” after 30 days, “Veteran” after a year. Checked every 10 minutes.">
        <RoleValueRows id="mt-tenure" guild={guild} assignableOnly rows={c.tenureRoles.map((t) => ({ roleId: t.roleId, value: t.days }))} onChange={(rows) => set({ ...c, tenureRoles: rows.map((r) => ({ roleId: r.roleId, days: r.value })) })} valueLabel="After days" min={1} max={3650} addLabel="Add a role" maxRows={10} defaultValue={30} />
      </Section>
    </>
  );
}
