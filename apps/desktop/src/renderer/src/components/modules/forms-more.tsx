import { FEED_VARIABLES, type GuildInfo, INVITE_VARIABLES, type ModuleConfigs, STAT_VARIABLES } from '@delyforge/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CategorySelect, RoleSelect, RoleValueRows, Section, TemplateField } from './fields';
import { ChannelChecklist, ChannelSelect, NumberField, ToggleRow } from './pickers';

type Props<K extends keyof ModuleConfigs> = { c: ModuleConfigs[K]; set: (c: ModuleConfigs[K]) => void; guild: GuildInfo };

export function InvitesForm({ c, set, guild }: Props<'invites'>) {
  return (
    <Section title="Announcements" description="Members can always check counts with /invites and /inviteboard. The bot needs the Manage Server permission to see invite links.">
      <ChannelSelect id="inv-channel" label="Announce new members in" emptyLabel="Don’t announce (logs and /invites only)" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
      {c.channelId ? <TemplateField id="inv-message" label="Message" max={500} value={c.message} onChange={(v) => set({ ...c, message: v })} variables={INVITE_VARIABLES} /> : null}
      <Field label="Invite rewards" htmlFor="inv-rewards" hint="A role for members who bring in enough people. Only invited members who are still in the server count, and the role is taken back if the count drops.">
        <RoleValueRows
          id="inv-rewards"
          guild={guild}
          assignableOnly
          rows={c.rewards.map((r) => ({ roleId: r.roleId, value: r.invites }))}
          onChange={(rows) => set({ ...c, rewards: rows.map((r) => ({ roleId: r.roleId, invites: r.value })) })}
          valueLabel="At invites"
          min={1}
          max={1000}
          addLabel="Add a reward"
          maxRows={10}
          defaultValue={5}
        />
      </Field>
    </Section>
  );
}

export function StarboardForm({ c, set, guild }: Props<'starboard'>) {
  return (
    <>
      <Section title="Starboard" description="When a message gets enough reactions, a copy is posted here with a link back.">
        <ChannelSelect id="star-channel" label="Starboard channel" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Emoji" htmlFor="star-emoji" hint="⭐, or a server emoji written like <:name:123…>">
            <Input id="star-emoji" maxLength={64} value={c.emoji} onChange={(e) => set({ ...c, emoji: e.target.value })} />
          </Field>
          <NumberField id="star-threshold" label="Reactions needed" min={1} max={100} value={c.threshold} onChange={(v) => set({ ...c, threshold: v })} />
        </div>
        <ToggleRow title="Count the author’s own reaction" checked={c.selfStar} onChange={(v) => set({ ...c, selfStar: v })} />
      </Section>
      <Section title="Ignored channels" description="Messages in these channels never go on the starboard.">
        <ChannelChecklist guild={guild} value={c.ignoredChannelIds} onChange={(ids) => set({ ...c, ignoredChannelIds: ids })} />
      </Section>
    </>
  );
}

export function TempVoiceForm({ c, set, guild }: Props<'tempVoice'>) {
  return (
    <Section title="Join to create" description="Members who join the hub get their own voice channel and are moved into it. They can rename it and set a limit; it’s deleted when everyone leaves.">
      <ChannelSelect id="tv-hub" label="Hub voice channel" emptyLabel="— Choose a voice channel —" kinds={['voice']} guild={guild} value={c.hubChannelId} onChange={(v) => set({ ...c, hubChannelId: v })} hint="Tip: create a voice channel called “➕ Create channel”." />
      <CategorySelect id="tv-category" label="Create channels in" hint="Leave empty to use the hub’s category." guild={guild} value={c.categoryId} onChange={(v) => set({ ...c, categoryId: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel name" htmlFor="tv-name" hint="{user} is the member’s name">
          <Input id="tv-name" maxLength={90} value={c.nameTemplate} onChange={(e) => set({ ...c, nameTemplate: e.target.value })} />
        </Field>
        <NumberField id="tv-limit" label="User limit (0 = none)" min={0} max={99} value={c.userLimit} onChange={(v) => set({ ...c, userLimit: v })} />
      </div>
      <ToggleRow title="Owner commands" description="Owners can use /voice lock, unlock, limit and rename; anyone can /voice claim a channel whose owner left." checked={c.ownerCommands} onChange={(v) => set({ ...c, ownerCommands: v })} />
    </Section>
  );
}

const RAID_ACTIONS = { alert: 'Only alert staff', kick: 'Kick them', ban: 'Ban them' } as const;

export function AntiRaidForm({ c, set, guild }: Props<'antiRaid'>) {
  return (
    <>
      <Section title="Alerts">
        <ChannelSelect id="raid-alerts" label="Alert staff in" guild={guild} value={c.alertChannelId} onChange={(v) => set({ ...c, alertChannelId: v })} />
      </Section>
      <Section title="Raid detection" description="A raid is many people joining at once. The alert lists them so staff can act.">
        <div className="grid grid-cols-2 gap-3">
          <NumberField id="raid-joins" label="Joins" min={3} max={100} suffix="members" value={c.joinThreshold} onChange={(v) => set({ ...c, joinThreshold: v })} />
          <NumberField id="raid-window" label="Within" min={5} max={600} suffix="seconds" value={c.perSeconds} onChange={(v) => set({ ...c, perSeconds: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="During a raid, new members" htmlFor="raid-action">
            <Select id="raid-action" value={c.raidAction} onChange={(e) => set({ ...c, raidAction: e.target.value as typeof c.raidAction })}>
              {Object.entries(RAID_ACTIONS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <NumberField id="raid-minutes" label="Raid mode lasts" min={1} max={120} suffix="minutes" value={c.raidMinutes} onChange={(v) => set({ ...c, raidMinutes: v })} />
        </div>
        <ToggleRow
          title="Lock the server down during a raid"
          description="Raises the server’s verification level to High (new members must wait 10 minutes before they can talk) and puts it back afterwards. Needs Manage Server."
          checked={c.lockdown}
          onChange={(v) => set({ ...c, lockdown: v })}
        />
      </Section>
      <Section title="New accounts" description="Throwaway accounts are the usual raid tool. They get a DM explaining why and can rejoin later.">
        <NumberField id="raid-age" label="Remove accounts younger than (0 = off)" min={0} max={90} suffix="days" value={c.minAccountAgeDays} onChange={(v) => set({ ...c, minAccountAgeDays: v })} />
      </Section>
    </>
  );
}

export function StickyForm({ c, set, guild }: Props<'sticky'>) {
  const update = (n: number, patch: Partial<(typeof c.messages)[number]>) => set({ ...c, messages: c.messages.map((m, i) => (i === n ? { ...m, ...patch } : m)) });
  return (
    <Section title="Sticky messages" description="After a channel goes quiet for a few seconds, the bot re-posts its sticky message at the bottom (and removes the old copy).">
      {c.messages.map((m, n) => (
        <div key={n} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <ChannelSelect id={`sticky-ch-${n}`} label="Channel" guild={guild} value={m.channelId} onChange={(v) => v && update(n, { channelId: v })} />
            </div>
            <Button size="icon" variant="ghost" aria-label="Remove sticky message" onClick={() => set({ ...c, messages: c.messages.filter((_, i) => i !== n) })}>
              <Trash2 />
            </Button>
          </div>
          <Field label="Message" htmlFor={`sticky-text-${n}`}>
            <Textarea id={`sticky-text-${n}`} rows={3} maxLength={2000} value={m.text} onChange={(e) => update(n, { text: e.target.value })} />
          </Field>
        </div>
      ))}
      <Button
        size="sm"
        disabled={c.messages.length >= 10 || !guild.channels.some((ch) => ch.kind === 'text')}
        onClick={() => {
          const free = guild.channels.find((ch) => ch.kind === 'text' && !c.messages.some((m) => m.channelId === ch.id));
          if (free) set({ ...c, messages: [...c.messages, { channelId: free.id, text: '' }] });
        }}
      >
        <Plus /> Add sticky message
      </Button>
    </Section>
  );
}

export function ServerStatsForm({ c, set, guild }: Props<'serverStats'>) {
  const update = (n: number, patch: Partial<(typeof c.counters)[number]>) => set({ ...c, counters: c.counters.map((x, i) => (i === n ? { ...x, ...patch } : x)) });
  return (
    <Section
      title="Counters"
      description={
        <>
          The bot renames these channels to show live numbers, every 10 minutes (Discord’s limit). Use voice channels nobody can join. You can use:{' '}
          {STAT_VARIABLES.map((v) => (
            <code key={v.key} className="mr-1 text-fg" title={v.description}>
              {v.key}
            </code>
          ))}
        </>
      }
    >
      {c.counters.map((x, n) => (
        <div key={n} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <ChannelSelect id={`stat-ch-${n}`} label="Channel" kinds={['voice', 'text', 'announcement']} guild={guild} value={x.channelId} onChange={(v) => v && update(n, { channelId: v })} />
          <Field label="Name" htmlFor={`stat-tpl-${n}`}>
            <Input id={`stat-tpl-${n}`} maxLength={90} value={x.template} onChange={(e) => update(n, { template: e.target.value })} />
          </Field>
          <Button size="icon" variant="ghost" aria-label="Remove counter" onClick={() => set({ ...c, counters: c.counters.filter((_, i) => i !== n) })}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        disabled={c.counters.length >= 5}
        onClick={() => {
          const free = guild.channels.find((ch) => ch.kind === 'voice' && !c.counters.some((x) => x.channelId === ch.id));
          if (free) set({ ...c, counters: [...c.counters, { channelId: free.id, template: 'Members: {members}' }] });
        }}
      >
        <Plus /> Add counter
      </Button>
    </Section>
  );
}

const localTime = (hourUtc: number) => new Date(Date.UTC(2026, 0, 1, hourUtc)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function BirthdaysForm({ c, set, guild }: Props<'birthdays'>) {
  return (
    <Section title="Celebrations" description="Members save their birthday with /birthday set. On the day, the bot posts a message and can give a role until the next day.">
      <ChannelSelect id="bday-channel" label="Celebrate in" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
      <TemplateField
        id="bday-message"
        label="Message"
        max={500}
        value={c.message}
        onChange={(v) => set({ ...c, message: v })}
        variables={[
          { key: '{user}', description: 'Mentions the birthday person' },
          { key: '{user.name}', description: 'Their display name' },
          { key: '{server}', description: 'Server name' },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <RoleSelect id="bday-role" label="Birthday role (optional)" assignableOnly guild={guild} value={c.roleId} onChange={(v) => set({ ...c, roleId: v })} />
        <NumberField id="bday-hour" label={`Announce at (UTC hour) — ${localTime(c.hourUtc)} your time`} min={0} max={23} value={c.hourUtc} onChange={(v) => set({ ...c, hourUtc: v })} />
      </div>
    </Section>
  );
}

export function FeedsForm({ c, set, guild }: Props<'feeds'>) {
  const update = (n: number, patch: Partial<(typeof c.feeds)[number]>) => set({ ...c, feeds: c.feeds.map((f, i) => (i === n ? { ...f, ...patch } : f)) });
  return (
    <Section title="Feeds" description="Checked every 10 minutes. The first check only remembers what’s already there, so old videos and posts aren’t announced.">
      {c.feeds.map((f, n) => (
        <div key={n} className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid grid-cols-[10rem_1fr_auto] items-end gap-2">
            <Field label="Type" htmlFor={`feed-kind-${n}`}>
              <Select id={`feed-kind-${n}`} value={f.kind} onChange={(e) => update(n, { kind: e.target.value as 'youtube' | 'rss' })}>
                <option value="youtube">YouTube channel</option>
                <option value="rss">RSS / news feed</option>
              </Select>
            </Field>
            <Field label={f.kind === 'youtube' ? 'Channel link (youtube.com/@name)' : 'Feed address (https://…)'} htmlFor={`feed-src-${n}`}>
              <Input
                id={`feed-src-${n}`}
                maxLength={300}
                value={f.source}
                placeholder={f.kind === 'youtube' ? 'https://youtube.com/@name' : 'https://example.com/feed.xml'}
                onChange={(e) => update(n, { source: e.target.value })}
              />
            </Field>
            <Button size="icon" variant="ghost" aria-label="Remove feed" onClick={() => set({ ...c, feeds: c.feeds.filter((_, i) => i !== n) })}>
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ChannelSelect id={`feed-ch-${n}`} label="Post in" guild={guild} value={f.channelId} onChange={(v) => v && update(n, { channelId: v })} />
            <RoleSelect id={`feed-role-${n}`} label="Role to ping with {role} (optional)" guild={guild} value={f.roleId} onChange={(v) => update(n, { roleId: v })} />
          </div>
          <TemplateField
            id={`feed-msg-${n}`}
            label="Message"
            max={500}
            value={f.message}
            onChange={(v) => update(n, { message: v })}
            variables={FEED_VARIABLES}
            sample={{ title: 'My newest video', link: 'https://youtu.be/example', author: 'Your Channel', role: '@Notifications' }}
          />
        </div>
      ))}
      <Button
        size="sm"
        disabled={c.feeds.length >= 20 || !guild.channels.some((ch) => ch.kind === 'text' || ch.kind === 'announcement')}
        onClick={() => {
          const ch = guild.channels.find((x) => x.kind === 'announcement') ?? guild.channels.find((x) => x.kind === 'text');
          if (ch) set({ ...c, feeds: [...c.feeds, { kind: 'youtube', source: '', channelId: ch.id, message: '{role} **{author}** posted: {title}\n{link}', roleId: null }] });
        }}
      >
        <Plus /> Add feed
      </Button>
    </Section>
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const myTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function ScheduledForm({ c, set, guild }: Props<'scheduled'>) {
  const update = (n: number, patch: Partial<(typeof c.messages)[number]>) => set({ ...c, messages: c.messages.map((m, i) => (i === n ? { ...m, ...patch } : m)) });
  return (
    <Section title="Scheduled messages" description="Posted on the chosen days at the chosen time. No days picked means every day.">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Time zone" htmlFor="sched-tz" hint="For example America/Chicago or Europe/London.">
            <Input id="sched-tz" maxLength={64} value={c.timezone} onChange={(e) => set({ ...c, timezone: e.target.value })} />
          </Field>
        </div>
        {c.timezone !== myTimeZone() ? (
          <Button size="sm" variant="secondary" onClick={() => set({ ...c, timezone: myTimeZone() })}>
            Use my time zone
          </Button>
        ) : null}
      </div>
      {c.messages.map((m, n) => (
        <div key={n} className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <ChannelSelect id={`sched-ch-${n}`} label="Channel" guild={guild} value={m.channelId} onChange={(v) => v && update(n, { channelId: v })} />
            <Field label="Time" htmlFor={`sched-time-${n}`}>
              <Input id={`sched-time-${n}`} type="time" value={m.time} onChange={(e) => e.target.value && update(n, { time: e.target.value })} />
            </Field>
            <Button size="icon" variant="ghost" aria-label="Remove scheduled message" onClick={() => set({ ...c, messages: c.messages.filter((_, i) => i !== n) })}>
              <Trash2 />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Days">
            {DAY_NAMES.map((d, day) => {
              const on = m.days.includes(day);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update(n, { days: on ? m.days.filter((x) => x !== day) : [...m.days, day].sort() })}
                  className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-primary-border bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg'}`}
                >
                  {d}
                </button>
              );
            })}
            {m.days.length ? null : <span className="text-xs text-fg-muted">Every day</span>}
          </div>
          <Field label="Message" htmlFor={`sched-text-${n}`} counter={{ value: m.text.length, max: 2000 }}>
            <Textarea id={`sched-text-${n}`} rows={3} maxLength={2000} value={m.text} onChange={(e) => update(n, { text: e.target.value })} />
          </Field>
          <RoleSelect id={`sched-role-${n}`} label="Ping a role (optional)" guild={guild} value={m.roleId} onChange={(v) => update(n, { roleId: v })} />
        </div>
      ))}
      <Button
        size="sm"
        disabled={c.messages.length >= 25 || !guild.channels.some((ch) => ch.kind === 'text')}
        onClick={() => {
          const ch = guild.channels.find((x) => x.kind === 'text');
          // The first message fills in your own time zone instead of the UTC default.
          const timezone = !c.messages.length && c.timezone === 'UTC' ? myTimeZone() : c.timezone;
          if (ch) set({ ...c, timezone, messages: [...c.messages, { channelId: ch.id, text: '', days: [], time: '09:00', roleId: null }] });
        }}
      >
        <Plus /> Add scheduled message
      </Button>
    </Section>
  );
}
