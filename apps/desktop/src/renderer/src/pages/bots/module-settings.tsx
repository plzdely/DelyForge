import {
  DEFAULT_MODULE_CONFIGS,
  DEVELOPER_PORTAL_URL,
  type GuildInfo,
  INTENTS,
  type ImplementedModuleId,
  LOG_EVENTS,
  type LogEvent,
  type LoggingConfig,
  type ModerationConfig,
  type ModuleConfigs,
  PERMISSIONS,
  TEMPLATE_VARIABLES,
  type UtilityConfig,
  type WelcomeConfig,
  hasFeature,
  isImplementedModule,
  lowestPlanWithFeature,
  moduleConfigSchemas,
  moduleInfo,
  moduleIntents,
  modulePermissions,
  renderTemplate,
  resolveGuildModules,
} from '@delyforge/shared';
import { ArrowLeft, ExternalLink, Lock, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { InviteLink } from '@/components/bots/permissions-editor';
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
import { ModuleWorkspaceGate, useModuleWorkspace } from './modules';

type Draft = ModuleConfigs[ImplementedModuleId];

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

/** Message box with clickable {variables} and a live preview. */
function TemplateField({ id, label, value, onChange, max = 2000 }: { id: string; label: string; value: string; onChange: (v: string) => void; max?: number }) {
  const preview = renderTemplate(value, { user: '@NewMember', 'user.name': 'NewMember', 'user.id': '123456789012345678', server: 'Your Server', memberCount: 128 });
  return (
    <Field label={label} htmlFor={id} counter={{ value: value.length, max }}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-24" />
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            title={v.description}
            onClick={() => onChange(`${value}${v.key}`)}
            className="rounded border border-border bg-surface-hover px-1.5 py-0.5 font-mono text-2xs text-fg-muted hover:text-fg"
          >
            {v.key}
          </button>
        ))}
      </div>
      {value ? <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs whitespace-pre-wrap text-fg-muted">Preview: {preview}</div> : null}
    </Field>
  );
}

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
          </>
        ) : null}
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
          </>
        ) : null}
      </Section>
      <Section title="Automatic roles" description="Given to every new member. The bot can only give roles below its own role.">
        <RoleChecklist guild={guild} assignableOnly value={c.autoRoles.roleIds} onChange={(ids) => set({ ...c, autoRoles: { roleIds: ids } })} />
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
        <ChannelSelect id="mod-log" label="Moderation log channel" hint="Every warning, timeout, kick, ban and auto-moderation action is recorded here." guild={guild} value={c.logChannelId} onChange={(v) => set({ ...c, logChannelId: v })} />
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
  messageDelete: ['Deleted messages', 'Who deleted what, where'],
  messageEdit: ['Edited messages', 'Before and after'],
  memberJoin: ['Members joining', 'Including account age'],
  memberLeave: ['Members leaving', ''],
  memberRoles: ['Role changes', 'Roles added to or removed from members'],
  channels: ['Channels', 'Channels created or deleted'],
  bans: ['Bans', 'Bans and unbans, with who did it'],
  voice: ['Voice', 'Joining, leaving and moving between voice channels'],
};

function LoggingForm({ c, set, guild }: { c: LoggingConfig; set: (c: LoggingConfig) => void; guild: GuildInfo }) {
  return (
    <>
      <Section title="Log channel" description="Use a private channel only staff can see.">
        <ChannelSelect id="log-channel" label="Channel" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
      </Section>
      <Section title="What to log">
        {LOG_EVENTS.map((e) => (
          <ToggleRow key={e} title={LOG_LABELS[e][0]} description={LOG_LABELS[e][1]} checked={c.events[e]} onChange={(v) => set({ ...c, events: { ...c.events, [e]: v } })} />
        ))}
      </Section>
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

  // Reset the draft when switching server or module, or when saved data first arrives.
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [guild?.id, id, ws.modules.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

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

          <fieldset disabled={locked} className="space-y-3">
            {id === 'welcome' ? <WelcomeForm c={draft as WelcomeConfig} set={setDraft} guild={guild} /> : null}
            {id === 'moderation' ? <ModerationForm c={draft as ModerationConfig} set={setDraft} guild={guild} automodLocked={automodLocked} /> : null}
            {id === 'logging' ? <LoggingForm c={draft as LoggingConfig} set={setDraft} guild={guild} /> : null}
            {id === 'utility' ? <UtilityForm c={draft as UtilityConfig} set={setDraft} /> : null}
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
