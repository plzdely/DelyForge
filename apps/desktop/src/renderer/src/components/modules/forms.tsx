import { type GuildInfo, type ModuleConfigs, type PanelConfig, type RolePanelConfig, xpToNextLevel } from '@delyforge/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CategorySelect, RoleSelect, RoleValueRows, Section, TemplateField } from './fields';
import { ChannelChecklist, ChannelSelect, NumberField, RoleChecklist, ToggleRow } from './pickers';

type Props<K extends keyof ModuleConfigs> = { c: ModuleConfigs[K]; set: (c: ModuleConfigs[K]) => void; guild: GuildInfo };

export function ColorField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Colour" htmlFor={id}>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-border-strong bg-bg-subtle p-1" />
    </Field>
  );
}

/** Title, text, button label, colour and channel of a posted panel. */
function PanelFields({ prefix, p, set, guild, note }: { prefix: string; p: PanelConfig; set: (p: PanelConfig) => void; guild: GuildInfo; note: string }) {
  return (
    <>
      <ChannelSelect id={`${prefix}-channel`} label="Post the panel in" hint={note} guild={guild} value={p.channelId} onChange={(v) => set({ ...p, channelId: v })} />
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Field label="Title" htmlFor={`${prefix}-title`}>
          <Input id={`${prefix}-title`} value={p.title} maxLength={256} onChange={(e) => set({ ...p, title: e.target.value })} />
        </Field>
        <ColorField id={`${prefix}-color`} value={p.color} onChange={(v) => set({ ...p, color: v })} />
      </div>
      <TemplateField id={`${prefix}-desc`} label="Text" value={p.description} variables={[]} onChange={(v) => set({ ...p, description: v })} />
      <Field label="Button label" htmlFor={`${prefix}-button`}>
        <Input id={`${prefix}-button`} value={p.buttonLabel} maxLength={80} onChange={(e) => set({ ...p, buttonLabel: e.target.value })} />
      </Field>
    </>
  );
}

const PANEL_NOTE = 'The bot posts this message and keeps it updated when you save.';

// ─── Leveling ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function LevelingForm({ c, set, guild }: Props<'leveling'>) {
  const avg = (c.xpMin + c.xpMax) / 2;
  const messagesFor = (level: number) => {
    let xp = 0;
    for (let l = 0; l < level; l++) xp += xpToNextLevel(l);
    return Math.ceil(xp / Math.max(1, avg));
  };
  return (
    <>
      <Section title="Earning XP" description={`Members earn ${c.xpMin}–${c.xpMax} XP per message, at most once every ${c.cooldownSeconds} seconds.`}>
        <div className="flex flex-wrap gap-4">
          <NumberField id="xp-min" label="Minimum XP" value={c.xpMin} min={1} max={100} onChange={(v) => set({ ...c, xpMin: v })} />
          <NumberField id="xp-max" label="Maximum XP" value={c.xpMax} min={1} max={200} onChange={(v) => set({ ...c, xpMax: v })} />
          <NumberField id="xp-cd" label="Cooldown" suffix="seconds" value={c.cooldownSeconds} min={0} max={3600} onChange={(v) => set({ ...c, cooldownSeconds: v })} />
        </div>
        <p className="text-xs text-fg-subtle">
          Roughly {messagesFor(5)} messages to reach level 5, {messagesFor(10)} for level 10, {messagesFor(20)} for level 20.
        </p>
        <Field label="No XP in these channels" htmlFor="xp-no-ch">
          <ChannelChecklist guild={guild} value={c.noXpChannelIds} onChange={(ids) => set({ ...c, noXpChannelIds: ids })} />
        </Field>
        <Field label="No XP for these roles" htmlFor="xp-no-roles">
          <RoleChecklist guild={guild} value={c.noXpRoleIds} onChange={(ids) => set({ ...c, noXpRoleIds: ids })} />
        </Field>
        <NumberField id="xp-voice" label="Voice XP" suffix="XP per minute (0 = off)" hint="For members talking with at least one other person, not deafened. Not in the AFK channel." min={0} max={50} value={c.voiceXpPerMinute} onChange={(v) => set({ ...c, voiceXpPerMinute: v })} />
        <ToggleRow title="Reset XP when a member leaves" description="Their XP and level are deleted if they leave the server." checked={c.resetOnLeave} onChange={(v) => set({ ...c, resetOnLeave: v })} />
      </Section>
      <Section title="XP boosts" description="Members with these roles earn more XP (the biggest boost counts) — e.g. 2× for server boosters. Staff can also use /xp give, take or set.">
        <RoleValueRows
          id="xp-boost"
          guild={guild}
          rows={c.multipliers.map((m) => ({ roleId: m.roleId, value: m.multiplier }))}
          onChange={(rows) => set({ ...c, multipliers: rows.map((r) => ({ roleId: r.roleId, multiplier: r.value })) })}
          valueLabel="Boost"
          min={1}
          max={5}
          choices={[1.25, 1.5, 2, 2.5, 3, 4, 5].map((v) => ({ value: v, label: `${v}× XP` }))}
          addLabel="Add a boost"
          maxRows={10}
          defaultValue={1.5}
        />
      </Section>
      <Section title="Level-up message">
        <ToggleRow title="Announce level-ups" checked={c.levelUp.enabled} onChange={(v) => set({ ...c, levelUp: { ...c.levelUp, enabled: v } })} />
        {c.levelUp.enabled ? <ToggleRow title="Send it as a DM instead" description="Keeps busy channels quiet." checked={c.levelUp.dm} onChange={(v) => set({ ...c, levelUp: { ...c.levelUp, dm: v } })} /> : null}
        {c.levelUp.enabled ? (
          <>
            <ChannelSelect
              id="lvl-channel"
              label="Channel"
              hint="Leave empty to announce in the channel where the member leveled up."
              guild={guild}
              value={c.levelUp.channelId}
              onChange={(v) => set({ ...c, levelUp: { ...c.levelUp, channelId: v } })}
            />
            <TemplateField
              id="lvl-message"
              label="Message"
              max={1000}
              value={c.levelUp.message}
              variables={[
                { key: '{user}', description: 'Mentions the member' },
                { key: '{user.name}', description: 'Display name' },
                { key: '{level}', description: 'The new level' },
                { key: '{server}', description: 'Server name' },
              ]}
              sample={{ level: 5 }}
              onChange={(v) => set({ ...c, levelUp: { ...c.levelUp, message: v } })}
            />
          </>
        ) : null}
      </Section>
      <Section title="Role rewards" description="Give a role when a member reaches a level.">
        {c.rewards.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <NumberField id={`rw-l-${i}`} label="Level" value={r.level} min={1} max={500} onChange={(v) => set({ ...c, rewards: c.rewards.map((x, j) => (j === i ? { ...x, level: v } : x)) })} />
            <div className="flex-1">
              <RoleSelect
                id={`rw-r-${i}`}
                label="Role"
                guild={guild}
                assignableOnly
                allowNone={false}
                value={r.roleId}
                onChange={(v) => v && set({ ...c, rewards: c.rewards.map((x, j) => (j === i ? { ...x, roleId: v } : x)) })}
              />
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove reward" onClick={() => set({ ...c, rewards: c.rewards.filter((_, j) => j !== i) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
        {c.rewards.length < 25 && guild.roles.length ? (
          <Button
            size="sm"
            onClick={() =>
              set({ ...c, rewards: [...c.rewards, { level: (c.rewards.at(-1)?.level ?? 0) + 5, roleId: guild.roles.find((r) => !r.managed && r.position < guild.botRolePosition)?.id ?? guild.roles[0]!.id }] })
            }
          >
            <Plus /> Add reward
          </Button>
        ) : null}
        <ToggleRow title="Keep earlier rewards" description="Off: members only keep the reward for their highest level." checked={c.stackRewards} onChange={(v) => set({ ...c, stackRewards: v })} />
      </Section>
    </>
  );
}

// ─── Tickets ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function TicketsForm({ c, set, guild }: Props<'tickets'>) {
  return (
    <>
      <Section title="Ticket panel" description="Members click its button to open a private channel with your staff.">
        <PanelFields prefix="tk" p={c.panel} set={(panel) => set({ ...c, panel })} guild={guild} note={PANEL_NOTE} />
      </Section>
      <Section title="Ticket channels">
        <CategorySelect id="tk-cat" label="Create tickets in category" guild={guild} value={c.categoryId} onChange={(v) => set({ ...c, categoryId: v })} />
        <Field label="Staff roles" htmlFor="tk-staff" hint="See and answer every ticket, and are pinged when one opens.">
          <RoleChecklist guild={guild} value={c.staffRoleIds} onChange={(ids) => set({ ...c, staffRoleIds: ids })} />
        </Field>
        <TemplateField id="tk-open" label="First message in a new ticket" value={c.openMessage} onChange={(v) => set({ ...c, openMessage: v })} />
        <ToggleRow title="Ping the staff roles" description="Mention them when a ticket opens." checked={c.pingStaff} onChange={(v) => set({ ...c, pingStaff: v })} />
        <NumberField id="tk-max" label="Open tickets per member" value={c.maxOpenPerUser} min={1} max={10} onChange={(v) => set({ ...c, maxOpenPerUser: v })} />
        <ToggleRow title="Ask what they need help with" description="A short pop-up before the ticket opens; the answer is shown to staff and kept in the transcript." checked={c.askReason} onChange={(v) => set({ ...c, askReason: v })} />
        <ToggleRow title="Claim button" description="Lets a staff member take the ticket, so members know who’s helping." checked={c.claimButton} onChange={(v) => set({ ...c, claimButton: v })} />
        <NumberField id="tk-idle" label="Close tickets with no messages for" suffix="hours (0 = never)" hint="Checked every 10 minutes. The transcript is saved as usual. Staff can also use /ticket add, remove and rename." min={0} max={336} value={c.autoCloseHours} onChange={(v) => set({ ...c, autoCloseHours: v })} />
      </Section>
      {c.extraPanels.map((x, n) => {
        const update = (patch: Partial<typeof x>) => set({ ...c, extraPanels: c.extraPanels.map((y, m) => (m === n ? { ...y, ...patch } : y)) });
        return (
          <Card key={x.id} className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">Ticket panel: {x.name || 'unnamed'}</h3>
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => set({ ...c, extraPanels: c.extraPanels.filter((_, m) => m !== n) })}>
                <Trash2 /> Remove
              </Button>
            </div>
            <Field label="Name" htmlFor={`tkx-name-${x.id}`} hint="Also starts the ticket channel names, e.g. #report-12-dely.">
              <Input id={`tkx-name-${x.id}`} maxLength={40} value={x.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <PanelFields prefix={`tkx-${x.id}`} p={x.panel} set={(panel) => update({ panel })} guild={guild} note={PANEL_NOTE} />
            <CategorySelect id={`tkx-cat-${x.id}`} label="Create these tickets in category" hint="Empty = the main ticket category." guild={guild} value={x.categoryId} onChange={(v) => update({ categoryId: v })} />
            <Field label="Extra staff for these tickets" htmlFor={`tkx-staff-${x.id}`} hint="The main staff roles above can always see every ticket.">
              <RoleChecklist guild={guild} value={x.staffRoleIds} onChange={(ids) => update({ staffRoleIds: ids })} />
            </Field>
            <TemplateField id={`tkx-open-${x.id}`} label="First message in these tickets" value={x.openMessage} onChange={(v) => update({ openMessage: v })} />
            <ToggleRow title="Ping the staff roles" checked={x.pingStaff} onChange={(v) => update({ pingStaff: v })} />
          </Card>
        );
      })}
      {c.extraPanels.length < 5 ? (
        <Button
          onClick={() =>
            set({
              ...c,
              extraPanels: [
                ...c.extraPanels,
                {
                  id: newPanelId(c.extraPanels),
                  name: 'Report',
                  panel: { channelId: null, title: 'Report a member', description: 'Click below to privately report someone to the moderators.', buttonLabel: 'Make a report', color: '#f04d5e' },
                  categoryId: null,
                  staffRoleIds: [],
                  openMessage: 'Thanks {user}. Tell us who you’re reporting and what happened — screenshots help.',
                  pingStaff: true,
                },
              ],
            })
          }
        >
          <Plus /> Add another ticket panel
        </Button>
      ) : null}
      <Section title="Transcripts" description="When a ticket closes, the conversation is saved as a text file before the channel is deleted.">
        <ChannelSelect id="tk-tr" label="Transcript channel" hint="Leave empty to not keep transcripts." guild={guild} value={c.transcriptChannelId} onChange={(v) => set({ ...c, transcriptChannelId: v })} />
        <ToggleRow title="Send the member a copy" checked={c.dmTranscript} onChange={(v) => set({ ...c, dmTranscript: v })} />
      </Section>
    </>
  );
}

// ─── Verification ─────────────────────────────────────────────────────────────────────────────────────────────────

export function VerificationForm({ c, set, guild }: Props<'verification'>) {
  return (
    <>
      <Section title="Roles" description="Tip: make most channels visible only to the verified role, so new members see just the verify panel.">
        <RoleSelect id="vf-role" label="Give this role when verified" guild={guild} assignableOnly value={c.roleId} onChange={(v) => set({ ...c, roleId: v })} />
        <RoleSelect id="vf-remove" label="Remove this role when verified (optional)" guild={guild} assignableOnly value={c.removeRoleId} onChange={(v) => set({ ...c, removeRoleId: v })} />
        <NumberField id="vf-age" label="Minimum account age" suffix="days (0 = off)" value={c.minAccountAgeDays} min={0} max={365} onChange={(v) => set({ ...c, minAccountAgeDays: v })} />
      </Section>
      <Section title="Extra checks">
        <Field label="Check question" htmlFor="vf-challenge" hint="A small sum in a pop-up stops simple bots that just click the button.">
          <Select id="vf-challenge" value={c.challenge} onChange={(e) => set({ ...c, challenge: e.target.value as typeof c.challenge })}>
            <option value="none">None — the button is enough</option>
            <option value="math">Ask a small sum (e.g. 4 + 7)</option>
          </Select>
        </Field>
        <NumberField
          id="vf-kick"
          label="Remove members who don’t verify within"
          suffix="hours (0 = never)"
          hint="Only members with no roles at all (apart from the “remove” role above) are removed, so staff are never kicked. Checked every 10 minutes; needs the Server Members intent."
          value={c.kickAfterHours}
          min={0}
          max={168}
          onChange={(v) => set({ ...c, kickAfterHours: v })}
        />
        <TemplateField id="vf-dm" label="DM after verifying (optional)" max={1000} value={c.dmMessage} onChange={(v) => set({ ...c, dmMessage: v })} />
      </Section>
      <Section title="Log" description="Every verify attempt is posted here: who, how old their account is, when they joined, and whether it worked. Make this channel staff-only.">
        <ChannelSelect id="vf-log" label="Verification log channel" emptyLabel="— Don’t log —" guild={guild} value={c.logChannelId} onChange={(v) => set({ ...c, logChannelId: v })} />
      </Section>
      <Section title="Verify panel">
        <PanelFields prefix="vf" p={c.panel} set={(panel) => set({ ...c, panel })} guild={guild} note={`${PANEL_NOTE} Choose the role first.`} />
      </Section>
    </>
  );
}

// ─── Reaction roles ───────────────────────────────────────────────────────────────────────────────────────────────

function newPanelId(existing: readonly { id: string }[]): string {
  for (let n = existing.length + 1; ; n++) if (!existing.some((p) => p.id === `p${n}`)) return `p${n}`;
}

export function ReactionRolesForm({ c, set, guild }: Props<'reactionRoles'>) {
  const update = (i: number, p: RolePanelConfig) => set({ ...c, panels: c.panels.map((x, j) => (j === i ? p : x)) });
  const firstRole = guild.roles.find((r) => !r.managed && r.position < guild.botRolePosition);
  return (
    <>
      {c.panels.map((p, i) => (
        <Card key={p.id} className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Panel {i + 1}</h3>
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => set({ ...c, panels: c.panels.filter((_, j) => j !== i) })}>
              <Trash2 /> Remove panel
            </Button>
          </div>
          <ChannelSelect id={`rr-${p.id}-ch`} label="Post in" hint={PANEL_NOTE} guild={guild} value={p.channelId} onChange={(v) => update(i, { ...p, channelId: v })} />
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="Title" htmlFor={`rr-${p.id}-t`}>
              <Input id={`rr-${p.id}-t`} value={p.title} maxLength={256} onChange={(e) => update(i, { ...p, title: e.target.value })} />
            </Field>
            <ColorField id={`rr-${p.id}-c`} value={p.color} onChange={(v) => update(i, { ...p, color: v })} />
          </div>
          <TemplateField id={`rr-${p.id}-d`} label="Text" value={p.description} variables={[]} onChange={(v) => update(i, { ...p, description: v })} />
          <div className="flex gap-3">
            <Field label="Style" htmlFor={`rr-${p.id}-m`}>
              <Select id={`rr-${p.id}-m`} className="w-44" value={p.mode} onChange={(e) => update(i, { ...p, mode: e.target.value as RolePanelConfig['mode'] })}>
                <option value="buttons">Buttons</option>
                <option value="menu">Drop-down menu</option>
              </Select>
            </Field>
            {p.mode === 'menu' ? (
              <ToggleRow title="Allow several roles" checked={p.multiple} onChange={(v) => update(i, { ...p, multiple: v })} />
            ) : (
              <ToggleRow title="One role only" description="Clicking a role swaps out the one they had from this panel (e.g. colours)." checked={p.oneRoleOnly} onChange={(v) => update(i, { ...p, oneRoleOnly: v })} />
            )}
          </div>
          <RoleSelect id={`rr-${p.id}-req`} label="Only members with this role can use it (optional)" guild={guild} value={p.requiredRoleId} onChange={(v) => update(i, { ...p, requiredRoleId: v })} />
          <div className="space-y-2">
            {p.roles.map((r, k) => (
              <div key={k} className="grid grid-cols-[1fr_1fr_80px_auto] items-end gap-2">
                <RoleSelect id={`rr-${p.id}-r${k}`} label="Role" guild={guild} assignableOnly allowNone={false} value={r.roleId} onChange={(v) => v && update(i, { ...p, roles: p.roles.map((x, m) => (m === k ? { ...x, roleId: v } : x)) })} />
                <Field label="Label" htmlFor={`rr-${p.id}-l${k}`}>
                  <Input id={`rr-${p.id}-l${k}`} value={r.label} maxLength={80} onChange={(e) => update(i, { ...p, roles: p.roles.map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) })} />
                </Field>
                <Field label="Emoji" htmlFor={`rr-${p.id}-e${k}`}>
                  <Input id={`rr-${p.id}-e${k}`} value={r.emoji} maxLength={16} placeholder="🎮" onChange={(e) => update(i, { ...p, roles: p.roles.map((x, m) => (m === k ? { ...x, emoji: e.target.value } : x)) })} />
                </Field>
                <Button variant="ghost" size="icon" aria-label="Remove role" disabled={p.roles.length === 1} onClick={() => update(i, { ...p, roles: p.roles.filter((_, m) => m !== k) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            {p.roles.length < 25 && firstRole ? (
              <Button size="sm" onClick={() => update(i, { ...p, roles: [...p.roles, { roleId: firstRole.id, label: firstRole.name, emoji: '' }] })}>
                <Plus /> Add role
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
      {c.panels.length < 10 ? (
        <Button
          disabled={!firstRole}
          onClick={() =>
            firstRole &&
            set({
              ...c,
              panels: [...c.panels, { id: newPanelId(c.panels), channelId: null, title: 'Pick your roles', description: 'Click a button to add or remove a role.', color: '#7c5cff', mode: 'buttons', multiple: true, oneRoleOnly: false, requiredRoleId: null, roles: [{ roleId: firstRole.id, label: firstRole.name, emoji: '' }] }],
            })
          }
        >
          <Plus /> Add a role panel
        </Button>
      ) : null}
      {!firstRole ? <p className="text-xs text-fg-subtle">Create a role below the bot’s role in Discord first, then press reload.</p> : null}
    </>
  );
}

// ─── Suggestions & giveaways ──────────────────────────────────────────────────────────────────────────────────────

export function SuggestionsForm({ c, set, guild }: Props<'suggestions'>) {
  return (
    <Section title="Suggestions" description="Members use /suggest. Ideas appear in the channel with 👍 / 👎 votes and Approve / Reject buttons for staff.">
      <ChannelSelect id="sg-ch" label="Suggestions channel" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
      <Field label="Staff roles" htmlFor="sg-staff" hint="Can approve or reject. Members with Manage Server always can.">
        <RoleChecklist guild={guild} value={c.staffRoleIds} onChange={(ids) => set({ ...c, staffRoleIds: ids })} />
      </Field>
      <ToggleRow title="Discussion threads" description="Opens a thread on every suggestion so people can talk about it." checked={c.threads} onChange={(v) => set({ ...c, threads: v })} />
      <ToggleRow title="Anonymous" description="Hides who made each suggestion." checked={c.anonymous} onChange={(v) => set({ ...c, anonymous: v })} />
      <ToggleRow title="Tell the author" description="DM them when their idea is approved or rejected, with the reason." checked={c.dmOnDecision} onChange={(v) => set({ ...c, dmOnDecision: v })} />
    </Section>
  );
}

export function GiveawaysForm({ c, set, guild }: Props<'giveaways'>) {
  return (
    <Section title="Giveaways" description="Start one with /giveaway start prize:Nitro duration:1d. Winners are picked at random when time is up — even if the bot restarted in between.">
      <Field label="Giveaway managers" htmlFor="gw-roles" hint="Can start, end and reroll giveaways. Members with Manage Server always can.">
        <RoleChecklist guild={guild} value={c.managerRoleIds} onChange={(ids) => set({ ...c, managerRoleIds: ids })} />
      </Field>
      <ColorField id="gw-color" value={c.color} onChange={(v) => set({ ...c, color: v })} />
      <Field label="Bonus entries" htmlFor="gw-bonus" hint="Members with these roles get extra chances to win (the biggest bonus counts) — e.g. boosters ×2.">
        <RoleValueRows
          id="gw-bonus"
          guild={guild}
          rows={c.bonusRoles.map((b) => ({ roleId: b.roleId, value: b.entries }))}
          onChange={(rows) => set({ ...c, bonusRoles: rows.map((r) => ({ roleId: r.roleId, entries: r.value })) })}
          valueLabel="Entries"
          min={2}
          max={10}
          choices={[2, 3, 4, 5, 10].map((v) => ({ value: v, label: `${v}× entries` }))}
          addLabel="Add a bonus"
          maxRows={5}
          defaultValue={2}
        />
      </Field>
    </Section>
  );
}
