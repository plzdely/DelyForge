import {
  DEFAULT_MODULE_CONFIGS,
  DEVELOPER_PORTAL_URL,
  type GuildInfo,
  INTENTS,
  type ImplementedModuleId,
  type ModuleTest,
  type LogEvent,
  type LoggingConfig,
  type ModerationConfig,
  type ModuleConfigs,
  PERMISSIONS,
  type UtilityConfig,
  type WelcomeConfig,
  hasFeature,
  isImplementedModule,
  lowestPlanWithFeature,
  moduleConfigSchemas,
  moduleInfo,
  moduleIntents,
  modulePermissions,
  resolveGuildModules,
} from '@delyforge/shared';
import { ArrowLeft, ExternalLink, FlaskConical, Lock, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { InviteLink } from '@/components/bots/permissions-editor';
import { LinkButtonsEditor, Section, TemplateField } from '@/components/modules/fields';
import { GiveawaysForm, LevelingForm, ReactionRolesForm, SuggestionsForm, TicketsForm, VerificationForm } from '@/components/modules/forms';
import { AntiRaidForm, BirthdaysForm, FeedsForm, InvitesForm, ScheduledForm, ServerStatsForm, StarboardForm, StickyForm, TempVoiceForm } from '@/components/modules/forms-more';
import {
  ChannelChecklist,
  ChannelSelect,
  GuildPicker,
  LinesInput,
  NumberField,
  RoleChecklist,
  ToggleRow,
} from '@/components/modules/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Separator } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { call } from '@/lib/bridge';
import { useEntitlements } from '@/lib/entitlements';
import { useUpdateModule } from '@/lib/modules';
import { useRuntimeControls, useRuntimeState } from '@/lib/runtime';
import { useUnsavedChangesGuard } from '@/lib/unsaved';
import { ModuleWorkspaceGate, useModuleWorkspace } from './modules';

type Draft = ModuleConfigs[ImplementedModuleId];

/** "Send a test" buttons: the running bot posts with the saved settings, using you as the example member. */
const TESTS: Partial<Record<ImplementedModuleId, { test: ModuleTest; label: string }[]>> = {
  welcome: [
    { test: 'welcome', label: 'Test welcome' },
    { test: 'goodbye', label: 'Test goodbye' },
  ],
  leveling: [{ test: 'levelUp', label: 'Test level-up' }],
  birthdays: [{ test: 'birthday', label: 'Test birthday' }],
  scheduled: [{ test: 'scheduled', label: 'Send the first message now' }],
  feeds: [{ test: 'feeds', label: 'Post the newest item of the first feed' }],
};

const ACTION_LABELS = { delete: 'Delete message', warn: 'Delete + warn', timeout: 'Delete + timeout' } as const;

function ActionSelect({ id, value, onChange }: { id: string; value: 'delete' | 'warn' | 'timeout'; onChange: (v: 'delete' | 'warn' | 'timeout') => void }) {
  return (
    <Select id={id} aria-label="Action" value={value} onChange={(e) => onChange(e.target.value as typeof value)} className="w-44">
      {Object.entries(ACTION_LABELS).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </Select>
  );
}

// ─── Forms ────────────────────────────────────────────────────────────────────────────────────────────────────────

function WelcomeForm({ c, set, guild }: { c: WelcomeConfig; set: (c: WelcomeConfig) => void; guild: GuildInfo }) {
  return (
    <>
      <Section title="Welcome message" description="Posted when someone joins.">
        <ToggleRow title="Send a welcome message" checked={c.welcome.enabled} onChange={(v) => set({ ...c, welcome: { ...c.welcome, enabled: v } })} />
        {c.welcome.enabled ? (
          <>
            <ChannelSelect id="welcome-channel" label="Channel" guild={guild} value={c.welcome.channelId} onChange={(v) => set({ ...c, welcome: { ...c.welcome, channelId: v } })} />
            <TemplateField id="welcome-message" label="Message" value={c.welcome.message} onChange={(v) => set({ ...c, welcome: { ...c.welcome, message: v } })} />
            <ToggleRow
              title="Show as a card (embed)"
              description="A coloured card with the member’s avatar."
              checked={c.welcome.style.embed}
              onChange={(v) => set({ ...c, welcome: { ...c.welcome, style: { ...c.welcome.style, embed: v } } })}
            />
            {c.welcome.style.embed ? (
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <Field label="Card title" htmlFor="welcome-title">
                  <Input id="welcome-title" value={c.welcome.style.title} maxLength={256} onChange={(e) => set({ ...c, welcome: { ...c.welcome, style: { ...c.welcome.style, title: e.target.value } } })} />
                </Field>
                <Field label="Colour" htmlFor="welcome-color">
                  <input
                    id="welcome-color"
                    type="color"
                    value={c.welcome.style.color}
                    onChange={(e) => set({ ...c, welcome: { ...c.welcome, style: { ...c.welcome.style, color: e.target.value } } })}
                    className="h-9 w-full cursor-pointer rounded-md border border-border-strong bg-bg-subtle p-1"
                  />
                </Field>
              </div>
            ) : null}
            {c.welcome.style.embed ? (
              <Field label="Banner image (optional)" htmlFor="welcome-image" hint="A picture shown under the card — paste an https:// image link.">
                <Input id="welcome-image" maxLength={2048} placeholder="https://…/banner.png" value={c.welcome.style.imageUrl} onChange={(e) => set({ ...c, welcome: { ...c.welcome, style: { ...c.welcome.style, imageUrl: e.target.value } } })} />
              </Field>
            ) : null}
            <LinkButtonsEditor id="welcome-btn" value={c.welcome.buttons} onChange={(buttons) => set({ ...c, welcome: { ...c.welcome, buttons } })} />
          </>
        ) : null}
      </Section>
      <Section title="Point new members to channels" description="The bot pings new members once in these channels (e.g. #rules) and deletes the ping a few seconds later, so the channel lights up for them.">
        <ChannelChecklist guild={guild} value={c.pingChannelIds} onChange={(ids) => set({ ...c, pingChannelIds: ids.slice(0, 5) })} />
      </Section>
      <Section title="Direct message" description="A private message to the new member. Some members block DMs from servers.">
        <ToggleRow title="Send a DM" checked={c.dm.enabled} onChange={(v) => set({ ...c, dm: { ...c.dm, enabled: v } })} />
        {c.dm.enabled ? <TemplateField id="dm-message" label="Message" value={c.dm.message} onChange={(v) => set({ ...c, dm: { ...c.dm, message: v } })} /> : null}
      </Section>
      <Section title="Goodbye message" description="Posted when someone leaves.">
        <ToggleRow title="Send a goodbye message" checked={c.goodbye.enabled} onChange={(v) => set({ ...c, goodbye: { ...c.goodbye, enabled: v } })} />
        {c.goodbye.enabled ? (
          <>
            <ChannelSelect id="goodbye-channel" label="Channel" guild={guild} value={c.goodbye.channelId} onChange={(v) => set({ ...c, goodbye: { ...c.goodbye, channelId: v } })} />
            <TemplateField id="goodbye-message" label="Message" value={c.goodbye.message} onChange={(v) => set({ ...c, goodbye: { ...c.goodbye, message: v } })} />
            <div className="grid grid-cols-[1fr_140px] items-end gap-3">
              <ToggleRow title="Show as a card (embed)" description="With the member’s avatar." checked={c.goodbye.embed} onChange={(v) => set({ ...c, goodbye: { ...c.goodbye, embed: v } })} />
              {c.goodbye.embed ? (
                <Field label="Colour" htmlFor="goodbye-color">
                  <input id="goodbye-color" type="color" value={c.goodbye.color} onChange={(e) => set({ ...c, goodbye: { ...c.goodbye, color: e.target.value } })} className="h-9 w-full cursor-pointer rounded-md border border-border-strong bg-bg-subtle p-1" />
                </Field>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>
      <Section title="Automatic roles" description="Given to every new member. The bot can only give roles below its own role.">
        <RoleChecklist guild={guild} assignableOnly value={c.autoRoles.roleIds} onChange={(ids) => set({ ...c, autoRoles: { ...c.autoRoles, roleIds: ids } })} />
        <NumberField id="welcome-delay" label="Give them after" suffix="minutes (0 = straight away)" min={0} max={60} value={c.autoRoles.delayMinutes} onChange={(v) => set({ ...c, autoRoles: { ...c.autoRoles, delayMinutes: v } })} />
      </Section>
      <Section title="Roles for bots" description="Given to bots that are added to the server, instead of the member roles above.">
        <RoleChecklist guild={guild} assignableOnly value={c.autoRoles.botRoleIds} onChange={(ids) => set({ ...c, autoRoles: { ...c.autoRoles, botRoleIds: ids } })} />
      </Section>
    </>
  );
}

function ModerationForm({ c, set, guild, automodLocked }: { c: ModerationConfig; set: (c: ModerationConfig) => void; guild: GuildInfo; automodLocked: string | null }) {
  const a = c.automod;
  const setA = (patch: Partial<ModerationConfig['automod']>) => set({ ...c, automod: { ...a, ...patch } });
  return (
    <>
      <Section title="Commands" description="Staff-only: Discord shows them only to members with the matching permission (e.g. Ban Members for /ban).">
        <div className="flex flex-wrap gap-1.5">
          {moduleInfo('moderation').commands.map((cmd) => (
            <Badge key={cmd}>{cmd}</Badge>
          ))}
        </div>
        <ChannelSelect id="mod-log" label="Moderation log channel" hint="Every action gets a numbered case here — including bans, kicks and timeouts done with Discord’s own buttons. Look them up with /history and /case." guild={guild} value={c.logChannelId} onChange={(v) => set({ ...c, logChannelId: v })} />
        <ToggleRow title="Tell members why" description="DM members when they are warned, timed out, kicked or banned." checked={c.dmMembers} onChange={(v) => set({ ...c, dmMembers: v })} />
      </Section>

      <Section title="Warning thresholds" description="Act automatically when a member reaches a number of warnings.">
        {c.thresholds.map((t, i) => (
          <div key={i} className="flex items-end gap-2">
            <NumberField id={`t-count-${i}`} label="Warnings" value={t.warnings} min={1} max={50} onChange={(v) => set({ ...c, thresholds: c.thresholds.map((x, j) => (j === i ? { ...x, warnings: v } : x)) })} />
            <Field label="Action" htmlFor={`t-action-${i}`}>
              <Select id={`t-action-${i}`} value={t.action} className="w-32" onChange={(e) => set({ ...c, thresholds: c.thresholds.map((x, j) => (j === i ? { ...x, action: e.target.value as typeof t.action } : x)) })}>
                <option value="timeout">Timeout</option>
                <option value="kick">Kick</option>
                <option value="ban">Ban</option>
              </Select>
            </Field>
            {t.action === 'timeout' ? (
              <NumberField id={`t-min-${i}`} label="Duration" suffix="minutes" value={t.minutes} min={1} max={40320} onChange={(v) => set({ ...c, thresholds: c.thresholds.map((x, j) => (j === i ? { ...x, minutes: v } : x)) })} />
            ) : null}
            <Button variant="ghost" size="icon" aria-label="Remove threshold" onClick={() => set({ ...c, thresholds: c.thresholds.filter((_, j) => j !== i) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
        {c.thresholds.length < 5 ? (
          <Button size="sm" onClick={() => set({ ...c, thresholds: [...c.thresholds, { warnings: (c.thresholds.at(-1)?.warnings ?? 2) + 1, action: 'kick', minutes: 60 }] })}>
            <Plus /> Add threshold
          </Button>
        ) : null}
      </Section>

      <Section
        title="Auto-moderation"
        description={automodLocked ?? 'Removes rule-breaking messages automatically. Members with Manage Messages and exempt roles are never affected.'}
      >
        <ToggleRow title="Enable auto-moderation" checked={a.enabled} disabled={Boolean(automodLocked) && !a.enabled} onChange={(v) => setA({ enabled: v })} badge={automodLocked ? <Badge><Lock /> Pro</Badge> : null} />
        {a.enabled ? (
          <>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Server invites" description="Links to other Discord servers." checked={a.invites.enabled} onChange={(v) => setA({ invites: { ...a.invites, enabled: v } })} />
              <ActionSelect id="am-invites" value={a.invites.action} onChange={(v) => setA({ invites: { ...a.invites, action: v } })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Scam links" description="Fake “free Nitro” and look-alike Discord or Steam sites that steal accounts." checked={a.scams.enabled} onChange={(v) => setA({ scams: { ...a.scams, enabled: v } })} />
              <ActionSelect id="am-scams" value={a.scams.action} onChange={(v) => setA({ scams: { ...a.scams, action: v } })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Mass mentions" description={`More than ${a.mentions.max} people or roles mentioned in one message.`} checked={a.mentions.enabled} onChange={(v) => setA({ mentions: { ...a.mentions, enabled: v } })} />
              <ActionSelect id="am-mentions" value={a.mentions.action} onChange={(v) => setA({ mentions: { ...a.mentions, action: v } })} />
            </div>
            {a.mentions.enabled ? <NumberField id="am-mentions-max" label="Most mentions allowed" value={a.mentions.max} min={2} max={50} onChange={(v) => setA({ mentions: { ...a.mentions, max: v } })} /> : null}
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Links" description="Any link not on the allowed list." checked={a.links.enabled} onChange={(v) => setA({ links: { ...a.links, enabled: v } })} />
              <ActionSelect id="am-links" value={a.links.action} onChange={(v) => setA({ links: { ...a.links, action: v } })} />
            </div>
            {a.links.enabled ? (
              <LinesInput id="am-domains" label="Allowed websites" hint="One per line, e.g. youtube.com (subdomains are included)." value={a.links.allowedDomains} onChange={(v) => setA({ links: { ...a.links, allowedDomains: v } })} />
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Blocked words" checked={a.words.enabled} onChange={(v) => setA({ words: { ...a.words, enabled: v } })} />
              <ActionSelect id="am-words" value={a.words.action} onChange={(v) => setA({ words: { ...a.words, action: v } })} />
            </div>
            {a.words.enabled ? (
              <LinesInput id="am-wordlist" label="Words" hint="One per line. Matches whole words and simple tricks like b.a.d." value={a.words.words} onChange={(v) => setA({ words: { ...a.words, words: v.map((w) => w.toLowerCase()) } })} />
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="All caps" description={`Messages of ${a.caps.minLength}+ letters that are at least ${a.caps.percent}% capitals.`} checked={a.caps.enabled} onChange={(v) => setA({ caps: { ...a.caps, enabled: v } })} />
              <ActionSelect id="am-caps" value={a.caps.action} onChange={(v) => setA({ caps: { ...a.caps, action: v } })} />
            </div>
            {a.caps.enabled ? (
              <div className="flex gap-4">
                <NumberField id="am-caps-len" label="Only messages with at least" suffix="letters" value={a.caps.minLength} min={5} max={200} onChange={(v) => setA({ caps: { ...a.caps, minLength: v } })} />
                <NumberField id="am-caps-pct" label="Capitals" suffix="%" value={a.caps.percent} min={50} max={100} onChange={(v) => setA({ caps: { ...a.caps, percent: v } })} />
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Emoji spam" description={`More than ${a.emoji.max} emoji in one message.`} checked={a.emoji.enabled} onChange={(v) => setA({ emoji: { ...a.emoji, enabled: v } })} />
              <ActionSelect id="am-emoji" value={a.emoji.action} onChange={(v) => setA({ emoji: { ...a.emoji, action: v } })} />
            </div>
            {a.emoji.enabled ? <NumberField id="am-emoji-max" label="Most emoji allowed" value={a.emoji.max} min={3} max={100} onChange={(v) => setA({ emoji: { ...a.emoji, max: v } })} /> : null}
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Repeated messages" description={`The same message ${a.repeats.count} times in a row within a minute.`} checked={a.repeats.enabled} onChange={(v) => setA({ repeats: { ...a.repeats, enabled: v } })} />
              <ActionSelect id="am-repeats" value={a.repeats.action} onChange={(v) => setA({ repeats: { ...a.repeats, action: v } })} />
            </div>
            {a.repeats.enabled ? <NumberField id="am-repeats-count" label="Times in a row" value={a.repeats.count} min={2} max={10} onChange={(v) => setA({ repeats: { ...a.repeats, count: v } })} /> : null}
            <div className="flex items-center justify-between gap-4">
              <ToggleRow title="Spam" description={`More than ${a.spam.maxMessages} messages in ${a.spam.perSeconds} seconds.`} checked={a.spam.enabled} onChange={(v) => setA({ spam: { ...a.spam, enabled: v } })} />
              <ActionSelect id="am-spam" value={a.spam.action} onChange={(v) => setA({ spam: { ...a.spam, action: v } })} />
            </div>
            {a.spam.enabled ? (
              <div className="flex gap-4">
                <NumberField id="am-max" label="Messages" value={a.spam.maxMessages} min={2} max={30} onChange={(v) => setA({ spam: { ...a.spam, maxMessages: v } })} />
                <NumberField id="am-per" label="Within" suffix="seconds" value={a.spam.perSeconds} min={2} max={60} onChange={(v) => setA({ spam: { ...a.spam, perSeconds: v } })} />
              </div>
            ) : null}
            <Separator />
            <NumberField id="am-timeout" label="Timeout length (for “Delete + timeout”)" suffix="minutes" value={a.timeoutMinutes} min={1} max={40320} onChange={(v) => setA({ timeoutMinutes: v })} />
            <Field label="Exempt roles" htmlFor="am-exempt" hint="Members with these roles are never auto-moderated.">
              <RoleChecklist guild={guild} value={a.exemptRoleIds} onChange={(ids) => setA({ exemptRoleIds: ids })} />
            </Field>
          </>
        ) : null}
      </Section>
    </>
  );
}

const LOG_LABELS: Record<LogEvent, [string, string]> = {
  messageDelete: ['Deleted messages', 'The text, the author and — when a moderator deleted it — who did'],
  messageEdit: ['Edited messages', 'Before and after, with a link to the message'],
  messageActions: ['Bulk deletes and pins', 'Who purged messages, pinned or unpinned them'],
  memberJoin: ['Members joining', 'With account age and a warning for brand-new accounts'],
  memberLeave: ['Members leaving', 'With how long they stayed and the roles they had'],
  memberRoles: ['Roles given or taken', 'Which roles a member got or lost, and who changed them'],
  members: ['Member changes', 'Nicknames, timeouts, kicks, voice moves and bots added — and who did it'],
  bans: ['Bans', 'Bans and unbans, who did it and why'],
  voice: ['Voice activity', 'Joining, leaving and moving between voice channels'],
  channels: ['Channels', 'Created, edited or deleted channels and permission changes, with who did it'],
  roles: ['Roles', 'Roles created, edited (name, colour, permissions) or deleted, with who did it'],
  server: ['Server settings', 'Name, icon, verification level and other settings, with who changed them'],
  invites: ['Invites', 'Who created or deleted invite links'],
  other: ['Everything else', 'Emojis, stickers, webhooks, events, threads, integrations and AutoMod rules'],
};

const LOG_GROUPS: { title: string; description: string; events: LogEvent[] }[] = [
  { title: 'Messages', description: 'What people wrote and what happened to it.', events: ['messageDelete', 'messageEdit', 'messageActions'] },
  { title: 'Members', description: 'People coming and going, and what staff did to them.', events: ['memberJoin', 'memberLeave', 'memberRoles', 'members', 'bans', 'voice'] },
  { title: 'Staff & server changes', description: 'Who changed the server itself, and what exactly changed.', events: ['channels', 'roles', 'server', 'invites', 'other'] },
];

function LoggingForm({ c, set, guild }: { c: LoggingConfig; set: (c: LoggingConfig) => void; guild: GuildInfo }) {
  // A group's separate channel applies to every event in it.
  const setGroupChannel = (events: LogEvent[], channelId: string | null) => {
    const overrides = { ...c.channelOverrides };
    for (const e of events) {
      if (channelId) overrides[e] = channelId;
      else delete overrides[e];
    }
    set({ ...c, channelOverrides: overrides });
  };
  return (
    <>
      <Section title="Log channel" description="Use a private channel only staff can see. “Who did it” comes from Discord’s audit log, so the bot needs the View Audit Log permission.">
        <ChannelSelect id="log-channel" label="Channel" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
      </Section>
      {LOG_GROUPS.map((g) => (
        <Section key={g.title} title={g.title} description={g.description}>
          {g.events.map((e) => (
            <ToggleRow key={e} title={LOG_LABELS[e][0]} description={LOG_LABELS[e][1]} checked={c.events[e]} onChange={(v) => set({ ...c, events: { ...c.events, [e]: v } })} />
          ))}
          <ChannelSelect
            id={`log-channel-${g.events[0]}`}
            label="Send these to their own channel (optional)"
            emptyLabel="Same as the main log channel"
            guild={guild}
            value={c.channelOverrides[g.events[0]!] ?? null}
            onChange={(v) => setGroupChannel(g.events, v)}
          />
        </Section>
      ))}
      <Section title="Ignored channels" description="Message deletes and edits in these channels are not logged.">
        <ChannelChecklist guild={guild} value={c.ignoredChannelIds} onChange={(ids) => set({ ...c, ignoredChannelIds: ids })} />
      </Section>
    </>
  );
}

const UTILITY_LABELS: Record<keyof UtilityConfig['commands'], [string, string]> = {
  serverinfo: ['/serverinfo', 'Members, channels, boosts and creation date'],
  userinfo: ['/userinfo', 'A member’s join date, account age and roles'],
  avatar: ['/avatar', 'Show anyone’s avatar in full size'],
  poll: ['/poll', 'Native Discord polls with up to 10 answers'],
};

function UtilityForm({ c, set }: { c: UtilityConfig; set: (c: UtilityConfig) => void }) {
  return (
    <Section title="Commands" description="Available to everyone in the server.">
      {(Object.keys(UTILITY_LABELS) as (keyof UtilityConfig['commands'])[]).map((k) => (
        <ToggleRow key={k} title={UTILITY_LABELS[k][0]} description={UTILITY_LABELS[k][1]} checked={c.commands[k]} onChange={(v) => set({ ...c, commands: { ...c.commands, [k]: v } })} />
      ))}
    </Section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ModuleSettings() {
  const { moduleId = '' } = useParams();
  const ws = useModuleWorkspace();
  const { bot, guild } = ws;
  const entitlements = useEntitlements();
  const update = useUpdateModule(bot.id);
  const state = useRuntimeState(bot.id);
  const { restart } = useRuntimeControls();
  const id = isImplementedModule(moduleId) ? moduleId : null;
  const saved = id && guild ? resolveGuildModules(ws.modules.data?.[guild.id])[id] : null;
  const [draft, setDraft] = useState<Draft | null>(saved);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [testing, setTesting] = useState<ModuleTest | null>(null);

  // Reset the draft when switching server or module, or when saved data first arrives.
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [guild?.id, id, ws.modules.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const guard = useUnsavedChangesGuard(draft !== null && JSON.stringify(draft) !== savedKey);

  if (!id) return <Card className="p-5 text-sm text-fg-muted">This module isn’t available yet.</Card>;
  const info = moduleInfo(id);
  const route = `/bots/${bot.id}/modules/${id}`;
  const plan = lowestPlanWithFeature(info.feature);
  const locked = !hasFeature(entitlements, info.feature);
  const automodLocked = hasFeature(entitlements, 'moderation.advanced') ? null : `Auto-moderation is part of the ${lowestPlanWithFeature('moderation.advanced')?.name ?? 'Pro'} plan.`;
  const dirty = draft !== null && JSON.stringify(draft) !== savedKey;

  const save = () => {
    if (!guild || !draft) return;
    const parsed = moduleConfigSchemas[id].safeParse(draft);
    if (!parsed.success) {
      toast.error('Please fix these settings', { description: parsed.error.issues[0]?.message });
      return;
    }
    update.mutate(
      { guildId: guild.id, moduleId: id, config: parsed.data },
      {
        onSuccess: (r) => {
          toast.success(`${info.name} settings saved`, { description: state.status === 'online' ? 'Applied to the running bot.' : undefined });
          setNeedsRestart(r.restartRequired);
        },
        onError: (e) => toast.error('Could not save', { description: e.message }),
      },
    );
  };

  // Discord requirements for the current draft.
  const intents = draft ? moduleIntents(id, draft) : 0;
  const missingIntents = INTENTS.filter(
    (i) => i.privileged && (intents & i.bit) !== 0 && bot.privilegedIntents && !bot.privilegedIntents[i.key as keyof typeof bot.privilegedIntents],
  );
  const neededPerms = draft ? modulePermissions(id, draft) : 0n;
  const missingPerms = guild ? PERMISSIONS.filter((p) => (neededPerms & p.bit) !== 0n && (BigInt(guild.botPermissions) & p.bit) === 0n) : [];

  return (
    <ModuleWorkspaceGate ws={ws} route={route}>
      {guard}
      {guild && draft ? (
        <div className="space-y-3 pb-16" data-route-ready={route}>
          <div className="flex items-center justify-between gap-4">
            <Link to={`/bots/${bot.id}/modules?server=${guild.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-fg-subtle hover:text-fg">
              <ArrowLeft className="size-3.5" /> All modules
            </Link>
            <GuildPicker guilds={ws.guilds.data ?? []} value={guild.id} onChange={ws.selectGuild} onRefresh={() => ws.refresh.mutate()} refreshing={ws.refresh.isPending} />
          </div>

          <Card className="flex items-center gap-4 p-5">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-fg">{info.name}</h2>
                {locked ? (
                  <Badge>
                    <Lock /> {plan?.name} plan
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-fg-muted">{info.summary}</p>
            </div>
            <span className="text-sm text-fg-muted">{draft.enabled ? 'On' : 'Off'}</span>
            <Switch
              aria-label={`Enable ${info.name}`}
              checked={draft.enabled}
              disabled={locked && !draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v } as Draft)}
            />
          </Card>

          {locked ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-primary-border bg-primary-soft px-4 py-3 text-sm text-fg-muted">
              {info.name} is included in the {plan?.name} plan. You can look around, but it can’t be switched on yet.
              <Button size="sm" asChild>
                <Link to="/subscription">View plans</Link>
              </Button>
            </div>
          ) : null}

          {draft.enabled && missingIntents.length ? (
            <Warning>
              Turn on <strong>{missingIntents.map((i) => i.label).join(' and ')}</strong> in the Developer Portal: open your application → <strong>Bot</strong> →{' '}
              <strong>Privileged Gateway Intents</strong>, switch it on and save. Then press reload above.
              <Button size="sm" className="mt-2" onClick={() => void call((b) => b.shell.openExternal(DEVELOPER_PORTAL_URL))}>
                Open Developer Portal <ExternalLink />
              </Button>
            </Warning>
          ) : null}

          {draft.enabled && missingPerms.length && bot.discordApplicationId ? (
            <Warning>
              In <strong>{guild.name}</strong> the bot is missing: {missingPerms.map((p) => p.label).join(', ')}. Give its role these permissions in Server Settings → Roles, or re-invite it with this link:
              <div className="mt-2">
                <InviteLink applicationId={bot.discordApplicationId} permissions={(BigInt(bot.permissions) | neededPerms).toString()} />
              </div>
            </Warning>
          ) : null}

          {needsRestart ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
              These settings need the bot to reconnect to Discord.
              <Button size="sm" variant="primary" disabled={restart.isPending} onClick={() => restart.mutate(bot.id, { onSuccess: () => setNeedsRestart(false) })}>
                <RotateCcw /> Restart bot
              </Button>
            </div>
          ) : null}

          {TESTS[id]?.length && !locked ? (
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <FlaskConical className="size-4 text-fg-subtle" />
              <p className="min-w-0 flex-1 text-sm text-fg-muted">
                {state.status !== 'online'
                  ? 'Start the bot to send a test message.'
                  : dirty
                    ? 'Save your changes first — tests use the saved settings.'
                    : !draft.enabled
                      ? 'Turn the module on and save to send a test.'
                      : 'See it for real: the bot posts once, with you as the example member. Roles aren’t pinged.'}
              </p>
              {TESTS[id]!.map((t) => (
                <Button
                  key={t.test}
                  size="sm"
                  disabled={state.status !== 'online' || dirty || !draft.enabled || testing !== null}
                  onClick={() => {
                    setTesting(t.test);
                    call((b) => b.modules.test({ id: bot.id, guildId: guild.id, test: t.test }))
                      .then((r) => (r.ok ? toast.success('Test sent', { description: r.message }) : toast.error('Test not sent', { description: r.message })))
                      .catch((e: Error) => toast.error('Test not sent', { description: e.message }))
                      .finally(() => setTesting(null));
                  }}
                >
                  {testing === t.test ? 'Sending…' : t.label}
                </Button>
              ))}
            </Card>
          ) : null}

          <fieldset disabled={locked} className="space-y-3">
            {id === 'welcome' ? <WelcomeForm c={draft as WelcomeConfig} set={setDraft} guild={guild} /> : null}
            {id === 'moderation' ? <ModerationForm c={draft as ModerationConfig} set={setDraft} guild={guild} automodLocked={automodLocked} /> : null}
            {id === 'logging' ? <LoggingForm c={draft as LoggingConfig} set={setDraft} guild={guild} /> : null}
            {id === 'utility' ? <UtilityForm c={draft as UtilityConfig} set={setDraft} /> : null}
            {id === 'leveling' ? <LevelingForm c={draft as ModuleConfigs['leveling']} set={setDraft} guild={guild} /> : null}
            {id === 'tickets' ? <TicketsForm c={draft as ModuleConfigs['tickets']} set={setDraft} guild={guild} /> : null}
            {id === 'verification' ? <VerificationForm c={draft as ModuleConfigs['verification']} set={setDraft} guild={guild} /> : null}
            {id === 'reactionRoles' ? <ReactionRolesForm c={draft as ModuleConfigs['reactionRoles']} set={setDraft} guild={guild} /> : null}
            {id === 'suggestions' ? <SuggestionsForm c={draft as ModuleConfigs['suggestions']} set={setDraft} guild={guild} /> : null}
            {id === 'giveaways' ? <GiveawaysForm c={draft as ModuleConfigs['giveaways']} set={setDraft} guild={guild} /> : null}
            {id === 'invites' ? <InvitesForm c={draft as ModuleConfigs['invites']} set={setDraft} guild={guild} /> : null}
            {id === 'starboard' ? <StarboardForm c={draft as ModuleConfigs['starboard']} set={setDraft} guild={guild} /> : null}
            {id === 'tempVoice' ? <TempVoiceForm c={draft as ModuleConfigs['tempVoice']} set={setDraft} guild={guild} /> : null}
            {id === 'antiRaid' ? <AntiRaidForm c={draft as ModuleConfigs['antiRaid']} set={setDraft} guild={guild} /> : null}
            {id === 'sticky' ? <StickyForm c={draft as ModuleConfigs['sticky']} set={setDraft} guild={guild} /> : null}
            {id === 'serverStats' ? <ServerStatsForm c={draft as ModuleConfigs['serverStats']} set={setDraft} guild={guild} /> : null}
            {id === 'birthdays' ? <BirthdaysForm c={draft as ModuleConfigs['birthdays']} set={setDraft} guild={guild} /> : null}
            {id === 'feeds' ? <FeedsForm c={draft as ModuleConfigs['feeds']} set={setDraft} guild={guild} /> : null}
            {id === 'scheduled' ? <ScheduledForm c={draft as ModuleConfigs['scheduled']} set={setDraft} guild={guild} /> : null}
          </fieldset>

          <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 rounded-xl border border-border bg-surface-raised/95 px-4 py-3 shadow-pop backdrop-blur">
            {dirty ? <span className="mr-auto text-xs text-fg-subtle">Unsaved changes</span> : <span className="mr-auto text-xs text-fg-subtle">All changes saved</span>}
            <Button size="sm" variant="ghost" onClick={() => setDraft(DEFAULT_MODULE_CONFIGS[id])}>
              Reset to defaults
            </Button>
            <Button disabled={!dirty || update.isPending} onClick={() => setDraft(saved)}>
              Discard
            </Button>
            <Button variant="primary" disabled={!dirty || update.isPending} onClick={save} data-testid="module-save">
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}
    </ModuleWorkspaceGate>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg-muted">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>{children}</div>
    </div>
  );
}
