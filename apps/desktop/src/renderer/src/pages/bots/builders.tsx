import {
  type Builders,
  COMMAND_VARIABLES,
  type CustomCommand,
  EMBED_LIMITS,
  type EmbedTemplate,
  type GuildInfo,
  INTENTS,
  INTENT_BITS,
  type Workflow,
  type WorkflowCondition,
  type WorkflowStep,
  type WorkflowTrigger,
  blankEmbed,
  builderIntents,
  buildersSchema,
  embedCharacterCount,
  hasFeature,
  lowestPlanWithFeature,
  newItemId,
  conditionAllowed,
  stepAllowed,
} from '@delyforge/shared';
import { ArrowDown, ArrowUp, CircleCheck, CircleX, Copy, Lock, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DiscordMessage, EmbedPreview } from '@/components/builders/discord-preview';
import { RoleSelect, TemplateField } from '@/components/modules/fields';
import { ChannelSelect, LinesInput, NumberField, ToggleRow } from '@/components/modules/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { useBuilders, useSaveBuilders, useWorkflowRuns } from '@/lib/builders';
import { useEntitlements } from '@/lib/entitlements';
import { timeAgo } from '@/lib/format';
import { useGuilds } from '@/lib/modules';
import { useRuntimeControls } from '@/lib/runtime';
import { useBotContext } from './layout';

// ─── Shared draft + save bar ──────────────────────────────────────────────────────────────────────────────────────

function useBuildersDraft() {
  const { bot } = useBotContext();
  const query = useBuilders(bot.id);
  const save = useSaveBuilders(bot.id);
  const [draft, setDraft] = useState<Builders | null>(null);
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data);
  }, [query.data, draft]);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(query.data);
  const submit = () => {
    if (!draft) return;
    const parsed = buildersSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error('Please fix this first', { description: `${issue?.message ?? 'Invalid settings'}` });
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: (saved) => {
        setDraft(saved);
        toast.success('Saved', { description: 'Running bots pick up the changes right away.' });
      },
      onError: (e) => toast.error('Could not save', { description: e.message }),
    });
  };
  return { bot, query, draft, setDraft, dirty, submit, saving: save.isPending, discard: () => setDraft(query.data ?? null) };
}

function SaveBar({ dirty, saving, onSave, onDiscard }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-xl border border-border bg-surface-raised/95 px-4 py-3 shadow-pop backdrop-blur">
      <span className="mr-auto text-xs text-fg-subtle">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <Button disabled={!dirty || saving} onClick={onDiscard}>
        Discard
      </Button>
      <Button variant="primary" disabled={!dirty || saving} onClick={onSave} data-testid="builders-save">
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );
}

/** List of items on the left, editor on the right. */
function ListEditor<T extends { id: string }>({
  items,
  selected,
  onSelect,
  label,
  sub,
  onAdd,
  addLabel,
  addDisabled,
  empty,
  children,
}: {
  items: T[];
  selected: string | null;
  onSelect: (id: string) => void;
  label: (t: T) => ReactNode;
  sub: (t: T) => ReactNode;
  onAdd: () => void;
  addLabel: string;
  addDisabled?: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[240px_1fr] gap-3">
      <Card className="h-fit p-2">
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={cn('block w-full rounded-md px-3 py-2 text-left transition-colors', selected === t.id ? 'bg-surface-hover' : 'hover:bg-surface-hover/60')}
          >
            <div className="truncate text-sm font-medium text-fg">{label(t)}</div>
            <div className="truncate text-2xs text-fg-subtle">{sub(t)}</div>
          </button>
        ))}
        <Button size="sm" variant="ghost" className="mt-1 w-full justify-start" onClick={onAdd} disabled={Boolean(addDisabled)}>
          <Plus /> {addLabel}
        </Button>
        {addDisabled ? <p className="px-3 pb-1 text-2xs text-fg-subtle">{addDisabled}</p> : null}
      </Card>
      <div className="min-w-0">{items.length ? children : <Card>{empty}</Card>}</div>
    </div>
  );
}

const replace = <T extends { id: string }>(list: T[], item: T) => list.map((x) => (x.id === item.id ? item : x));

// ─── Commands ─────────────────────────────────────────────────────────────────────────────────────────────────────

const newCommand = (taken: CustomCommand[]): CustomCommand => {
  const id = newItemId(taken);
  return {
    id,
    enabled: true,
    type: 'slash',
    name: `command${id.slice(1)}`,
    description: 'A custom command',
    options: [],
    access: 'everyone',
    cooldownSeconds: 3,
    response: { text: 'Hello {user}! 👋', embedId: '', ephemeral: false, buttons: [] },
  };
};

export function CommandsTab() {
  const d = useBuildersDraft();
  const [selected, setSelected] = useState<string | null>(null);
  if (!d.draft) return <Skeleton className="h-64 rounded-xl" />;
  const b = d.draft;
  const cmd = b.commands.find((c) => c.id === selected) ?? b.commands[0];
  const set = (c: CustomCommand) => d.setDraft({ ...b, commands: replace(b.commands, c) });
  const embed = cmd?.response.embedId ? b.embeds.find((e) => e.id === cmd.response.embedId) : undefined;

  return (
    <div className="space-y-3" data-route-ready={`/bots/${d.bot.id}/commands`}>
      <ListEditor
        items={b.commands}
        selected={cmd?.id ?? null}
        onSelect={setSelected}
        label={(c) => (c.type === 'slash' ? `/${c.name}` : c.name)}
        sub={(c) => `${c.type === 'slash' ? 'Slash command' : c.type === 'user' ? 'Right-click a member' : 'Right-click a message'}${c.enabled ? '' : ' · off'}`}
        addLabel="New command"
        onAdd={() => {
          const c = newCommand(b.commands);
          d.setDraft({ ...b, commands: [...b.commands, c] });
          setSelected(c.id);
        }}
        empty={<EmptyState icon={Plus} title="No custom commands yet" description="Make /commands your members can use — no code needed." />}
      >
        {cmd ? (
          <div className="grid grid-cols-[1fr_360px] gap-3">
            <div className="space-y-3">
              <Card>
                <CardHeader
                  title="Command"
                  action={
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-fg-muted">{cmd.enabled ? 'On' : 'Off'}</span>
                      <Switch aria-label="Enabled" checked={cmd.enabled} onCheckedChange={(v) => set({ ...cmd, enabled: v })} />
                    </div>
                  }
                />
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-[180px_1fr] gap-3">
                    <Field label="Type" htmlFor="cmd-type">
                      <Select id="cmd-type" value={cmd.type} onChange={(e) => set({ ...cmd, type: e.target.value as CustomCommand['type'], options: e.target.value === 'slash' ? cmd.options : [] })}>
                        <option value="slash">Slash command</option>
                        <option value="user">Right-click a member</option>
                        <option value="message">Right-click a message</option>
                      </Select>
                    </Field>
                    <Field label="Name" htmlFor="cmd-name" hint={cmd.type === 'slash' ? 'Lowercase, no spaces — members type /name.' : 'Shown under Apps when right-clicking.'}>
                      <Input id="cmd-name" value={cmd.name} maxLength={32} onChange={(e) => set({ ...cmd, name: cmd.type === 'slash' ? e.target.value.toLowerCase().replace(/\s/g, '-') : e.target.value })} />
                    </Field>
                  </div>
                  {cmd.type === 'slash' ? (
                    <Field label="Description" htmlFor="cmd-desc">
                      <Input id="cmd-desc" value={cmd.description} maxLength={100} onChange={(e) => set({ ...cmd, description: e.target.value })} />
                    </Field>
                  ) : null}
                  <div className="flex gap-4">
                    <Field label="Who can use it" htmlFor="cmd-access">
                      <Select id="cmd-access" className="w-56" value={cmd.access} onChange={(e) => set({ ...cmd, access: e.target.value as CustomCommand['access'] })}>
                        <option value="everyone">Everyone</option>
                        <option value="moderators">Moderators (Manage Messages)</option>
                        <option value="admins">Admins (Manage Server)</option>
                      </Select>
                    </Field>
                    <NumberField id="cmd-cd" label="Cooldown per member" suffix="seconds" value={cmd.cooldownSeconds} min={0} max={86400} onChange={(v) => set({ ...cmd, cooldownSeconds: v })} />
                  </div>
                </CardBody>
              </Card>

              {cmd.type === 'slash' ? (
                <Card>
                  <CardHeader title="Options" description="Extra inputs members fill in, used in the reply as {option:name}." />
                  <CardBody className="space-y-2">
                    {cmd.options.map((o, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_110px_auto_auto] items-end gap-2">
                        <Field label="Name" htmlFor={`o-n-${i}`}>
                          <Input id={`o-n-${i}`} value={o.name} maxLength={32} onChange={(e) => set({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, name: e.target.value.toLowerCase().replace(/\s/g, '-') } : x)) })} />
                        </Field>
                        <Field label="Description" htmlFor={`o-d-${i}`}>
                          <Input id={`o-d-${i}`} value={o.description} maxLength={100} onChange={(e) => set({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                        </Field>
                        <Field label="Type" htmlFor={`o-t-${i}`}>
                          <Select id={`o-t-${i}`} value={o.type} onChange={(e) => set({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, type: e.target.value as typeof o.type } : x)) })}>
                            <option value="text">Text</option>
                            <option value="user">Member</option>
                            <option value="number">Number</option>
                          </Select>
                        </Field>
                        <label className="flex h-9 items-center gap-1.5 text-xs text-fg-muted">
                          <input type="checkbox" className="accent-[var(--df-primary)]" checked={o.required} onChange={(e) => set({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />
                          Required
                        </label>
                        <Button variant="ghost" size="icon" aria-label="Remove option" onClick={() => set({ ...cmd, options: cmd.options.filter((_, j) => j !== i) })}>
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    {cmd.options.length < 5 ? (
                      <Button size="sm" onClick={() => set({ ...cmd, options: [...cmd.options, { name: `option${cmd.options.length + 1}`, description: 'Describe it', type: 'text', required: false }] })}>
                        <Plus /> Add option
                      </Button>
                    ) : null}
                  </CardBody>
                </Card>
              ) : null}

              <Card>
                <CardHeader title="Reply" />
                <CardBody className="space-y-4">
                  <TemplateField id="cmd-text" label="Message" value={cmd.response.text} variables={COMMAND_VARIABLES} onChange={(v) => set({ ...cmd, response: { ...cmd.response, text: v } })} />
                  <Field label="Embed" htmlFor="cmd-embed" hint={b.embeds.length ? undefined : 'Create one on the Embeds tab.'}>
                    <Select id="cmd-embed" value={cmd.response.embedId} onChange={(e) => set({ ...cmd, response: { ...cmd.response, embedId: e.target.value } })}>
                      <option value="">— No embed —</option>
                      {b.embeds.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <ToggleRow title="Only visible to the person who used it" checked={cmd.response.ephemeral} onChange={(v) => set({ ...cmd, response: { ...cmd.response, ephemeral: v } })} />
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-fg">Link buttons</div>
                    {cmd.response.buttons.map((btn, i) => (
                      <div key={i} className="grid grid-cols-[160px_1fr_auto] gap-2">
                        <Input aria-label="Button label" value={btn.label} maxLength={80} onChange={(e) => set({ ...cmd, response: { ...cmd.response, buttons: cmd.response.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })} />
                        <Input aria-label="Button link" placeholder="https://" value={btn.url} onChange={(e) => set({ ...cmd, response: { ...cmd.response, buttons: cmd.response.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) } })} />
                        <Button variant="ghost" size="icon" aria-label="Remove button" onClick={() => set({ ...cmd, response: { ...cmd.response, buttons: cmd.response.buttons.filter((_, j) => j !== i) } })}>
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    {cmd.response.buttons.length < 5 ? (
                      <Button size="sm" onClick={() => set({ ...cmd, response: { ...cmd.response, buttons: [...cmd.response.buttons, { label: 'Website', url: 'https://' }] } })}>
                        <Plus /> Add link button
                      </Button>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
              <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => d.setDraft({ ...b, commands: b.commands.filter((c) => c.id !== cmd.id) })}>
                <Trash2 /> Delete command
              </Button>
            </div>
            <div className="sticky top-4 h-fit space-y-2">
              <div className="text-xs font-medium text-fg-subtle">Preview</div>
              <DiscordMessage botName={d.bot.botUsername ?? d.bot.name} avatarUrl={d.bot.botAvatarUrl} text={cmd.response.text} ephemeral={cmd.response.ephemeral}>
                {embed ? <EmbedPreview e={embed} /> : null}
                {cmd.response.buttons.length ? (
                  <div className="flex flex-wrap gap-2">
                    {cmd.response.buttons.map((btn, i) => (
                      <span key={i} className="rounded bg-[#4e5058] px-3 py-1 text-[13px] text-white">
                        {btn.label} ↗
                      </span>
                    ))}
                  </div>
                ) : null}
              </DiscordMessage>
              <p className="text-2xs text-fg-subtle">Variables show example values. New commands can take a minute to appear in Discord.</p>
            </div>
          </div>
        ) : null}
      </ListEditor>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={d.submit} onDiscard={d.discard} />
    </div>
  );
}

// ─── Embeds ───────────────────────────────────────────────────────────────────────────────────────────────────────

function UrlField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} placeholder="https://" value={value} onChange={(e) => onChange(e.target.value.trim())} />
    </Field>
  );
}

export function EmbedsTab() {
  const d = useBuildersDraft();
  const entitlements = useEntitlements();
  const [selected, setSelected] = useState<string | null>(null);
  if (!d.draft) return <Skeleton className="h-64 rounded-xl" />;
  const b = d.draft;
  const e = b.embeds.find((x) => x.id === selected) ?? b.embeds[0];
  const set = (x: EmbedTemplate) => d.setDraft({ ...b, embeds: replace(b.embeds, x) });
  const locked = !hasFeature(entitlements, 'builder.embeds');
  const chars = e ? embedCharacterCount(e) : 0;

  return (
    <div className="space-y-3" data-route-ready={`/bots/${d.bot.id}/embeds`}>
      <ListEditor
        items={b.embeds}
        selected={e?.id ?? null}
        onSelect={setSelected}
        label={(x) => x.name}
        sub={(x) => x.title || 'No title'}
        addLabel="New embed"
        addDisabled={locked ? `Saved embeds are a ${lowestPlanWithFeature('builder.embeds')?.name} feature.` : null}
        onAdd={() => {
          const x = blankEmbed(newItemId(b.embeds));
          d.setDraft({ ...b, embeds: [...b.embeds, x] });
          setSelected(x.id);
        }}
        empty={<EmptyState icon={locked ? Lock : Plus} title="No saved embeds" description="Design rich cards once and reuse them in commands and automations." />}
      >
        {e ? (
          <div className="grid grid-cols-[1fr_440px] gap-3">
            <div className="space-y-3">
              <Card>
                <CardHeader title="Embed" description={`${chars} / ${EMBED_LIMITS.total} characters`} />
                <CardBody className="space-y-4">
                  <Field label="Name (only shown in DelyForge)" htmlFor="em-name">
                    <Input id="em-name" value={e.name} maxLength={60} onChange={(ev) => set({ ...e, name: ev.target.value })} />
                  </Field>
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <Field label="Title" htmlFor="em-title" counter={{ value: e.title.length, max: EMBED_LIMITS.title }}>
                      <Input id="em-title" value={e.title} onChange={(ev) => set({ ...e, title: ev.target.value })} />
                    </Field>
                    <Field label="Colour" htmlFor="em-color">
                      <input id="em-color" type="color" value={e.color} onChange={(ev) => set({ ...e, color: ev.target.value })} className="h-9 w-full cursor-pointer rounded-md border border-border-strong bg-bg-subtle p-1" />
                    </Field>
                  </div>
                  <UrlField id="em-url" label="Title link" value={e.url} onChange={(v) => set({ ...e, url: v })} />
                  <TemplateField id="em-desc" label="Description" max={EMBED_LIMITS.description} value={e.description} variables={COMMAND_VARIABLES} onChange={(v) => set({ ...e, description: v })} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Fields" description="Up to 25. Inline fields sit side by side (3 per row)." />
                <CardBody className="space-y-3">
                  {e.fields.map((f, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                      <div className="flex gap-2">
                        <Input aria-label="Field name" placeholder="Name" maxLength={EMBED_LIMITS.fieldName} value={f.name} onChange={(ev) => set({ ...e, fields: e.fields.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) })} />
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                          <input type="checkbox" className="accent-[var(--df-primary)]" checked={f.inline} onChange={(ev) => set({ ...e, fields: e.fields.map((x, j) => (j === i ? { ...x, inline: ev.target.checked } : x)) })} />
                          Inline
                        </label>
                        <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => set({ ...e, fields: swap(e.fields, i, i - 1) })}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Remove field" onClick={() => set({ ...e, fields: e.fields.filter((_, j) => j !== i) })}>
                          <Trash2 />
                        </Button>
                      </div>
                      <textarea
                        aria-label="Field value"
                        maxLength={EMBED_LIMITS.fieldValue}
                        value={f.value}
                        onChange={(ev) => set({ ...e, fields: e.fields.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)) })}
                        className="min-h-16 w-full resize-y rounded-md border border-border-strong bg-bg-subtle px-3 py-2 text-sm text-fg outline-none focus:border-primary"
                      />
                    </div>
                  ))}
                  {e.fields.length < EMBED_LIMITS.fields ? (
                    <Button size="sm" onClick={() => set({ ...e, fields: [...e.fields, { name: 'Field', value: 'Value', inline: true }] })}>
                      <Plus /> Add field
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Author, images & footer" />
                <CardBody className="grid grid-cols-2 gap-3">
                  <Field label="Author" htmlFor="em-author" counter={{ value: e.authorName.length, max: EMBED_LIMITS.author }}>
                    <Input id="em-author" value={e.authorName} onChange={(ev) => set({ ...e, authorName: ev.target.value })} />
                  </Field>
                  <UrlField id="em-author-icon" label="Author icon" value={e.authorIconUrl} onChange={(v) => set({ ...e, authorIconUrl: v })} />
                  <UrlField id="em-thumb" label="Thumbnail (top right)" value={e.thumbnailUrl} onChange={(v) => set({ ...e, thumbnailUrl: v })} />
                  <UrlField id="em-image" label="Large image" value={e.imageUrl} onChange={(v) => set({ ...e, imageUrl: v })} />
                  <Field label="Footer" htmlFor="em-footer" counter={{ value: e.footerText.length, max: EMBED_LIMITS.footer }}>
                    <Input id="em-footer" value={e.footerText} onChange={(ev) => set({ ...e, footerText: ev.target.value })} />
                  </Field>
                  <UrlField id="em-footer-icon" label="Footer icon" value={e.footerIconUrl} onChange={(v) => set({ ...e, footerIconUrl: v })} />
                  <div className="col-span-2">
                    <ToggleRow title="Show the time it was sent" checked={e.timestamp} onChange={(v) => set({ ...e, timestamp: v })} />
                  </div>
                </CardBody>
              </Card>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => {
                    const copy = { ...e, id: newItemId(b.embeds), name: `${e.name} (copy)`.slice(0, 60) };
                    d.setDraft({ ...b, embeds: [...b.embeds, copy] });
                    setSelected(copy.id);
                  }}
                >
                  <Copy /> Duplicate
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() =>
                    d.setDraft({
                      ...b,
                      embeds: b.embeds.filter((x) => x.id !== e.id),
                      // Commands that used it fall back to text only.
                      commands: b.commands.map((c) => (c.response.embedId === e.id ? { ...c, response: { ...c.response, embedId: '' } } : c)),
                    })
                  }
                >
                  <Trash2 /> Delete embed
                </Button>
              </div>
            </div>
            <div className="sticky top-4 h-fit space-y-2">
              <div className="text-xs font-medium text-fg-subtle">Live preview</div>
              <DiscordMessage botName={d.bot.botUsername ?? d.bot.name} avatarUrl={d.bot.botAvatarUrl}>
                <EmbedPreview e={e} />
              </DiscordMessage>
              {chars > EMBED_LIMITS.total ? (
                <p className="text-xs text-danger">Too long for Discord — remove {chars - EMBED_LIMITS.total} characters.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </ListEditor>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={d.submit} onDiscard={d.discard} />
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const out = list.slice();
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}

// ─── Automations ──────────────────────────────────────────────────────────────────────────────────────────────────

const TRIGGERS: { type: WorkflowTrigger['type']; label: string }[] = [
  { type: 'memberJoin', label: 'A member joins' },
  { type: 'memberLeave', label: 'A member leaves' },
  { type: 'messageContains', label: 'A message contains a word' },
  { type: 'roleAdded', label: 'A member gets a role' },
  { type: 'reactionAdded', label: 'Someone reacts with an emoji' },
  { type: 'memberBoost', label: 'A member boosts the server' },
  { type: 'voiceJoin', label: 'A member joins a voice channel' },
  { type: 'schedule', label: 'On a schedule (days and time)' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultTrigger(type: WorkflowTrigger['type'], guild: GuildInfo): WorkflowTrigger {
  switch (type) {
    case 'messageContains':
      return { type, keyword: 'help', channelId: null };
    case 'roleAdded':
      return { type, roleId: guild.roles[0]?.id ?? guild.id };
    case 'reactionAdded':
      return { type, emoji: '✅', channelId: null };
    case 'voiceJoin':
      return { type, channelId: null };
    case 'schedule':
      return { type, time: '09:00', days: [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    default:
      return { type };
  }
}

/** How deep each step sits inside If blocks (for indenting). */
function stepDepths(steps: readonly WorkflowStep[]): number[] {
  let depth = 0;
  return steps.map((s) => {
    if (s.type === 'endIf' || s.type === 'else') depth = Math.max(0, depth - 1);
    const d = depth;
    if (s.type === 'if' || s.type === 'else') depth++;
    return d;
  });
}

const CONDITION_LABELS: Record<WorkflowCondition['kind'], string> = {
  hasRole: 'the member has a role',
  accountOlderThan: 'the account is old enough',
  text: 'a text or variable matches',
};

function defaultCondition(kind: WorkflowCondition['kind'], guild: GuildInfo): WorkflowCondition {
  if (kind === 'hasRole') return { kind, roleId: guild.roles[0]?.id ?? guild.id, negate: false };
  if (kind === 'accountOlderThan') return { kind, days: 7 };
  return { kind, text: '{var:count}', op: 'greaterThan', value: '10', negate: false };
}

const STEP_LABELS: Record<WorkflowStep['type'], string> = {
  sendMessage: 'Send a message to a channel',
  reply: 'Reply to the message',
  sendDM: 'Send the member a DM',
  addRole: 'Give a role',
  removeRole: 'Remove a role',
  deleteMessage: 'Delete the message',
  wait: 'Wait',
  ifHasRole: 'Only continue if the member has / doesn’t have a role',
  ifAccountOlderThan: 'Only continue if the account is old enough',
  createThread: 'Start a thread on the message',
  timeout: 'Time out the member',
  sendRandom: 'Send one random message from a list',
  setVariable: 'Save a variable',
  if: 'If …',
  else: 'Otherwise',
  endIf: 'End if',
};

function defaultStep(type: WorkflowStep['type'], guild: GuildInfo): WorkflowStep {
  const channel = guild.channels.find((c) => c.kind === 'text')?.id ?? guild.id;
  const role = guild.roles.find((r) => !r.managed && r.position < guild.botRolePosition)?.id ?? guild.roles[0]?.id ?? guild.id;
  switch (type) {
    case 'sendMessage':
      return { type, channelId: channel, text: 'Welcome {user}!', embedId: '' };
    case 'reply':
      return { type, text: 'Thanks {user}!' };
    case 'sendDM':
      return { type, text: 'Hi {user.name}, welcome to {server}!' };
    case 'addRole':
    case 'removeRole':
      return { type, roleId: role };
    case 'deleteMessage':
      return { type };
    case 'wait':
      return { type, seconds: 5 };
    case 'ifHasRole':
      return { type, roleId: role, negate: false };
    case 'ifAccountOlderThan':
      return { type, days: 7 };
    case 'createThread':
      return { type, name: 'Talk with {user.name}' };
    case 'timeout':
      return { type, minutes: 10 };
    case 'sendRandom':
      return { type, channelId: channel, texts: ['Hello {user}!', 'Hey {user}, welcome!'] };
    case 'setVariable':
      return { type, name: 'count', mode: 'add', value: '1' };
    case 'if':
      return { type, check: defaultCondition('text', guild) };
    case 'else':
    case 'endIf':
      return { type };
  }
}

function ConditionEditor({ check, set, guild, trigger }: { check: WorkflowCondition; set: (c: WorkflowCondition) => void; guild: GuildInfo; trigger: WorkflowTrigger['type'] }) {
  return (
    <div className="space-y-3">
      <Field label="Check that" htmlFor="st-cond">
        <Select id="st-cond" value={check.kind} onChange={(e) => set(defaultCondition(e.target.value as WorkflowCondition['kind'], guild))}>
          {(Object.keys(CONDITION_LABELS) as WorkflowCondition['kind'][])
            .filter((k) => conditionAllowed(trigger, k))
            .map((k) => (
              <option key={k} value={k}>
                {CONDITION_LABELS[k]}
              </option>
            ))}
        </Select>
      </Field>
      {check.kind === 'hasRole' ? (
        <>
          <RoleSelect id="st-cond-role" label="Role" guild={guild} allowNone={false} value={check.roleId} onChange={(v) => v && set({ ...check, roleId: v })} />
          <ToggleRow title="Pass when they DON’T have it" checked={check.negate} onChange={(v) => set({ ...check, negate: v })} />
        </>
      ) : null}
      {check.kind === 'accountOlderThan' ? <NumberField id="st-cond-days" label="Account at least" suffix="days old" value={check.days} min={0} max={3650} onChange={(v) => set({ ...check, days: v })} /> : null}
      {check.kind === 'text' ? (
        <>
          <div className="grid grid-cols-[1fr_9rem_1fr] items-end gap-2">
            <Field label="Text" htmlFor="st-cond-a">
              <Input id="st-cond-a" maxLength={200} value={check.text} onChange={(e) => set({ ...check, text: e.target.value })} />
            </Field>
            <Field label="Is" htmlFor="st-cond-op">
              <Select id="st-cond-op" value={check.op} onChange={(e) => set({ ...check, op: e.target.value as typeof check.op })}>
                <option value="equals">equal to</option>
                <option value="contains">containing</option>
                <option value="greaterThan">more than</option>
                <option value="lessThan">less than</option>
              </Select>
            </Field>
            <Field label="Value" htmlFor="st-cond-b">
              <Input id="st-cond-b" maxLength={200} value={check.value} onChange={(e) => set({ ...check, value: e.target.value })} />
            </Field>
          </div>
          <ToggleRow title="Pass when it does NOT match" checked={check.negate} onChange={(v) => set({ ...check, negate: v })} />
          <p className="text-xs text-fg-subtle">Use variables like {'{var:count}'} or {'{user.name}'}. “More than” and “less than” compare numbers.</p>
        </>
      ) : null}
    </div>
  );
}

function StepEditor({ step, set, guild, embeds, trigger }: { step: WorkflowStep; set: (s: WorkflowStep) => void; guild: GuildInfo; embeds: EmbedTemplate[]; trigger: WorkflowTrigger['type'] }) {
  switch (step.type) {
    case 'sendMessage':
      return (
        <div className="space-y-3">
          <ChannelSelect id="st-ch" label="Channel" guild={guild} value={step.channelId} onChange={(v) => v && set({ ...step, channelId: v })} />
          <TemplateField id="st-text" label="Message" value={step.text} onChange={(v) => set({ ...step, text: v })} />
          <Field label="Embed" htmlFor="st-embed">
            <Select id="st-embed" value={step.embedId} onChange={(e) => set({ ...step, embedId: e.target.value })}>
              <option value="">— No embed —</option>
              {embeds.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      );
    case 'reply':
    case 'sendDM':
      return <TemplateField id="st-text" label="Message" value={step.text} onChange={(v) => set({ ...step, text: v })} />;
    case 'addRole':
    case 'removeRole':
      return <RoleSelect id="st-role" label="Role" guild={guild} assignableOnly allowNone={false} value={step.roleId} onChange={(v) => v && set({ ...step, roleId: v })} />;
    case 'ifHasRole':
      return (
        <div className="space-y-3">
          <RoleSelect id="st-role" label="Role" guild={guild} allowNone={false} value={step.roleId} onChange={(v) => v && set({ ...step, roleId: v })} />
          <ToggleRow title="Continue only if they DON’T have it" checked={step.negate} onChange={(v) => set({ ...step, negate: v })} />
        </div>
      );
    case 'ifAccountOlderThan':
      return <NumberField id="st-days" label="Account at least" suffix="days old" value={step.days} min={0} max={3650} onChange={(v) => set({ ...step, days: v })} />;
    case 'wait':
      return <NumberField id="st-wait" label="Wait" suffix="seconds (max 3600)" value={step.seconds} min={1} max={3600} onChange={(v) => set({ ...step, seconds: v })} />;
    case 'deleteMessage':
      return <p className="text-xs text-fg-subtle">Deletes the message that started this workflow.</p>;
    case 'createThread':
      return <TemplateField id="st-thread" label="Thread name" max={100} value={step.name} onChange={(v) => set({ ...step, name: v })} />;
    case 'timeout':
      return <NumberField id="st-timeout" label="Time out for" suffix="minutes (max 28 days)" value={step.minutes} min={1} max={40320} onChange={(v) => set({ ...step, minutes: v })} />;
    case 'sendRandom':
      return (
        <div className="space-y-3">
          <ChannelSelect id="st-ch" label="Channel" guild={guild} value={step.channelId} onChange={(v) => v && set({ ...step, channelId: v })} />
          <LinesInput id="st-texts" label="Messages" hint="One message per line (2–10). Variables like {user} work." value={step.texts} onChange={(v) => set({ ...step, texts: v.slice(0, 10) })} />
        </div>
      );
    case 'setVariable':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_10rem] items-end gap-2">
            <Field label="Variable name" htmlFor="st-var">
              <Input id="st-var" maxLength={32} value={step.name} onChange={(e) => set({ ...step, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
            </Field>
            <Field label="How" htmlFor="st-var-mode">
              <Select id="st-var-mode" value={step.mode} onChange={(e) => set({ ...step, mode: e.target.value as 'set' | 'add' })}>
                <option value="set">Set it to</option>
                <option value="add">Add a number</option>
              </Select>
            </Field>
          </div>
          <Field label={step.mode === 'add' ? 'Number to add' : 'Value'} htmlFor="st-var-value">
            <Input id="st-var-value" maxLength={200} value={step.value} onChange={(e) => set({ ...step, value: e.target.value })} />
          </Field>
          <p className="text-xs text-fg-subtle">
            Saved for this server and kept between runs. Use it in later messages as <code className="text-fg">{`{var:${step.name || 'name'}}`}</code>.
          </p>
        </div>
      );
    case 'if':
      return <ConditionEditor check={step.check} guild={guild} trigger={trigger} set={(check) => set({ ...step, check })} />;
    case 'else':
      return <p className="text-xs text-fg-subtle">The steps from here to “End if” run when the check above didn’t pass.</p>;
    case 'endIf':
      return <p className="text-xs text-fg-subtle">Steps after this run either way.</p>;
  }
}

export function AutomationsTab() {
  const d = useBuildersDraft();
  const entitlements = useEntitlements();
  const guilds = useGuilds(d.bot.id, d.bot.hasToken);
  const runs = useWorkflowRuns(d.bot.id);
  const { restart } = useRuntimeControls();
  const [selected, setSelected] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState(0);
  const intentWarning = useMemo(() => {
    if (!d.draft || !d.bot.privilegedIntents) return [];
    const bits = builderIntents(d.draft, INTENT_BITS);
    return INTENTS.filter((i) => i.privileged && (bits & i.bit) !== 0 && !d.bot.privilegedIntents![i.key as keyof typeof d.bot.privilegedIntents]);
  }, [d.draft, d.bot.privilegedIntents]);

  if (!d.draft) return <Skeleton className="h-64 rounded-xl" />;
  if (!d.bot.hasToken) {
    return <Card data-route-ready={`/bots/${d.bot.id}/automations`}><EmptyState icon={Lock} title="Connect this bot first" description="Automations run inside your Discord servers." /></Card>;
  }
  const b = d.draft;
  const max = entitlements.limits.maxWorkflows;
  const w = b.workflows.find((x) => x.id === selected) ?? b.workflows[0];
  const set = (x: Workflow) => d.setDraft({ ...b, workflows: replace(b.workflows, x) });
  const guildList = guilds.data ?? [];
  const guild = w ? guildList.find((g) => g.id === w.guildId) : undefined;
  const wfRuns = (runs.data ?? []).filter((r) => r.workflowId === w?.id).slice(0, 10);

  return (
    <div className="space-y-3" data-route-ready={`/bots/${d.bot.id}/automations`}>
      {intentWarning.length ? (
        <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          These workflows need the <strong className="mx-1">{intentWarning.map((i) => i.label).join(' and ')}</strong> intent. Turn it on in the Developer Portal (Bot → Privileged Gateway Intents), then restart the bot.
        </div>
      ) : null}
      <ListEditor
        items={b.workflows}
        selected={w?.id ?? null}
        onSelect={(id) => {
          setSelected(id);
          setOpenStep(0);
        }}
        label={(x) => x.name}
        sub={(x) => `${TRIGGERS.find((t) => t.type === x.trigger.type)?.label ?? ''}${x.enabled ? '' : ' · off'}`}
        addLabel="New workflow"
        addDisabled={max !== null && b.workflows.length >= max ? `Your plan includes ${max} workflows.` : !guildList.length ? 'Invite the bot to a server first.' : null}
        onAdd={() => {
          const g = guildList[0]!;
          const x: Workflow = { id: newItemId(b.workflows), name: 'Welcome flow', enabled: true, guildId: g.id, trigger: { type: 'memberJoin' }, steps: [{ type: 'wait', seconds: 5 }, defaultStep('sendDM', g)] };
          d.setDraft({ ...b, workflows: [...b.workflows, x] });
          setSelected(x.id);
        }}
        empty={<EmptyState icon={Plus} title="No automations yet" description="Example: when a member joins → wait 5 seconds → give a role → send a welcome DM." />}
      >
        {w ? (
          !guild ? (
            guilds.isLoading ? (
              <Skeleton className="h-64 rounded-xl" />
            ) : (
              <Card className="p-5 text-sm text-fg-muted">This workflow’s server isn’t available — the bot may have left it.</Card>
            )
          ) : (
            <div className="grid grid-cols-[1fr_300px] gap-3">
              <div className="space-y-3">
                <Card>
                  <CardHeader
                    title="Workflow"
                    action={
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-fg-muted">{w.enabled ? 'On' : 'Off'}</span>
                        <Switch aria-label="Enabled" checked={w.enabled} onCheckedChange={(v) => set({ ...w, enabled: v })} />
                      </div>
                    }
                  />
                  <CardBody className="grid grid-cols-2 gap-3">
                    <Field label="Name" htmlFor="wf-name">
                      <Input id="wf-name" value={w.name} maxLength={60} onChange={(e) => set({ ...w, name: e.target.value })} />
                    </Field>
                    <Field label="Server" htmlFor="wf-guild">
                      <Select id="wf-guild" value={w.guildId} onChange={(e) => set({ ...w, guildId: e.target.value })}>
                        {guildList.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </CardBody>
                </Card>

                {/* The flow: trigger, then each step */}
                <div className="relative space-y-2 pl-6 before:absolute before:top-3 before:bottom-3 before:left-2.5 before:w-px before:bg-border-strong">
                  <FlowNode tone="primary" title="When" subtitle={TRIGGERS.find((t) => t.type === w.trigger.type)?.label}>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Trigger" htmlFor="wf-trigger">
                        <Select
                          id="wf-trigger"
                          value={w.trigger.type}
                          onChange={(e) => {
                            const type = e.target.value as WorkflowTrigger['type'];
                            const kept = w.steps.filter((s) => stepAllowed(type, s.type) && (s.type !== 'if' || conditionAllowed(type, s.check.kind)));
                            // Dropping a step can break If blocks; then keep only the plain steps.
                            const steps = kept.length === w.steps.length ? kept : kept.filter((s) => s.type !== 'if' && s.type !== 'else' && s.type !== 'endIf');
                            set({ ...w, trigger: defaultTrigger(type, guild), steps: steps.length ? steps : [defaultStep(type === 'schedule' ? 'sendMessage' : 'sendDM', guild)] });
                          }}
                        >
                          {TRIGGERS.map((t) => (
                            <option key={t.type} value={t.type}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {w.trigger.type === 'messageContains' ? (
                        <Field label="Word or phrase" htmlFor="wf-kw">
                          <Input id="wf-kw" value={w.trigger.keyword} maxLength={100} onChange={(e) => w.trigger.type === 'messageContains' && set({ ...w, trigger: { ...w.trigger, keyword: e.target.value } })} />
                        </Field>
                      ) : null}
                      {w.trigger.type === 'roleAdded' ? (
                        <RoleSelect id="wf-role" label="Role" guild={guild} allowNone={false} value={w.trigger.roleId} onChange={(v) => v && set({ ...w, trigger: { type: 'roleAdded', roleId: v } })} />
                      ) : null}
                      {w.trigger.type === 'reactionAdded' ? (
                        <Field label="Emoji" htmlFor="wf-emoji" hint="An emoji like ✅, or a custom emoji’s name.">
                          <Input id="wf-emoji" maxLength={64} value={w.trigger.emoji} onChange={(e) => w.trigger.type === 'reactionAdded' && set({ ...w, trigger: { ...w.trigger, emoji: e.target.value } })} />
                        </Field>
                      ) : null}
                      {w.trigger.type === 'voiceJoin' ? (
                        <ChannelSelect id="wf-voice" label="Voice channel" emptyLabel="— Any voice channel —" kinds={['voice']} guild={guild} value={w.trigger.channelId} onChange={(v) => w.trigger.type === 'voiceJoin' && set({ ...w, trigger: { ...w.trigger, channelId: v } })} />
                      ) : null}
                      {w.trigger.type === 'schedule' ? (
                        <Field label="Time" htmlFor="wf-time">
                          <Input id="wf-time" type="time" value={w.trigger.time} onChange={(e) => w.trigger.type === 'schedule' && e.target.value && set({ ...w, trigger: { ...w.trigger, time: e.target.value } })} />
                        </Field>
                      ) : null}
                    </div>
                    {w.trigger.type === 'schedule' ? (
                      <div className="mt-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Days">
                          {DAY_NAMES.map((name, day) => {
                            const t = w.trigger.type === 'schedule' ? w.trigger : null;
                            const on = t?.days.includes(day) ?? false;
                            return (
                              <button
                                key={name}
                                type="button"
                                aria-pressed={on}
                                onClick={() => t && set({ ...w, trigger: { ...t, days: on ? t.days.filter((x) => x !== day) : [...t.days, day].sort() } })}
                                className={cn('rounded-md border px-2 py-1 text-xs', on ? 'border-primary-border bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg')}
                              >
                                {name}
                              </button>
                            );
                          })}
                          {w.trigger.days.length ? null : <span className="text-xs text-fg-muted">Every day</span>}
                        </div>
                        <Field label="Time zone" htmlFor="wf-tz" hint="For example America/Chicago.">
                          <Input id="wf-tz" maxLength={64} value={w.trigger.timezone} onChange={(e) => w.trigger.type === 'schedule' && set({ ...w, trigger: { ...w.trigger, timezone: e.target.value } })} />
                        </Field>
                      </div>
                    ) : null}
                    {w.trigger.type === 'reactionAdded' ? (
                      <div className="mt-3">
                        <ChannelSelect id="wf-react-ch" label="Only in channel (optional)" guild={guild} value={w.trigger.channelId} onChange={(v) => w.trigger.type === 'reactionAdded' && set({ ...w, trigger: { ...w.trigger, channelId: v } })} />
                      </div>
                    ) : null}
                    {w.trigger.type === 'messageContains' ? (
                      <div className="mt-3">
                        <ChannelSelect id="wf-kw-ch" label="Only in channel (optional)" guild={guild} value={w.trigger.channelId} onChange={(v) => w.trigger.type === 'messageContains' && set({ ...w, trigger: { ...w.trigger, channelId: v } })} />
                      </div>
                    ) : null}
                  </FlowNode>

                  {w.steps.map((s, i) => (
                    <div key={i} style={{ marginLeft: `${stepDepths(w.steps)[i]! * 1.5}rem` }}>
                    <FlowNode
                      tone={s.type.startsWith('if') || s.type === 'else' || s.type === 'endIf' ? 'warning' : s.type === 'wait' ? 'neutral' : 'success'}
                      title={`${i + 1}. ${s.type === 'if' ? `If ${CONDITION_LABELS[s.check.kind]}` : STEP_LABELS[s.type]}`}
                      subtitle={s.type === 'wait' ? `${s.seconds}s` : undefined}
                      open={openStep === i}
                      onToggle={() => setOpenStep(openStep === i ? -1 : i)}
                      actions={
                        <>
                          <Button variant="ghost" size="icon" className="size-7" aria-label="Move up" disabled={i === 0} onClick={() => set({ ...w, steps: swap(w.steps, i, i - 1) })}>
                            <ArrowUp />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" aria-label="Move down" disabled={i === w.steps.length - 1} onClick={() => set({ ...w, steps: swap(w.steps, i, i + 1) })}>
                            <ArrowDown />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" aria-label="Remove step" disabled={w.steps.length === 1} onClick={() => set({ ...w, steps: w.steps.filter((_, j) => j !== i) })}>
                            <Trash2 />
                          </Button>
                        </>
                      }
                    >
                      <StepEditor step={s} guild={guild} embeds={b.embeds} trigger={w.trigger.type} set={(x) => set({ ...w, steps: w.steps.map((y, j) => (j === i ? x : y)) })} />
                    </FlowNode>
                    </div>
                  ))}

                  {w.steps.length < 20 ? (
                    <div className="pl-1">
                      <Select
                        aria-label="Add a step"
                        value=""
                        className="w-80"
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const type = e.target.value as WorkflowStep['type'];
                          // A new "If" comes with its "End if", so the blocks always line up.
                          const added = type === 'if' ? [defaultStep('if', guild), defaultStep('endIf', guild)] : [defaultStep(type, guild)];
                          set({ ...w, steps: [...w.steps, ...added].slice(0, 20) });
                          setOpenStep(w.steps.length);
                        }}
                      >
                        <option value="">+ Add a step…</option>
                        {(Object.keys(STEP_LABELS) as WorkflowStep['type'][])
                          .filter((t) => stepAllowed(w.trigger.type, t))
                          .map((t) => (
                            <option key={t} value={t}>
                              {STEP_LABELS[t]}
                            </option>
                          ))}
                      </Select>
                    </div>
                  ) : null}
                </div>
                <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => d.setDraft({ ...b, workflows: b.workflows.filter((x) => x.id !== w.id) })}>
                  <Trash2 /> Delete workflow
                </Button>
              </div>

              <Card className="h-fit">
                <CardHeader title="Recent runs" description="Updates every 10 seconds." />
                <CardBody className="space-y-2">
                  {wfRuns.length === 0 ? <p className="text-xs text-fg-subtle">No runs yet. Saved workflows run in the running bot straight away.</p> : null}
                  {wfRuns.map((r) => (
                    <div key={r.id} className="flex gap-2 text-xs">
                      {r.ok ? <CircleCheck className="mt-px size-3.5 shrink-0 text-success" /> : <CircleX className="mt-px size-3.5 shrink-0 text-danger" />}
                      <div className="min-w-0">
                        <div className="text-fg-muted">{r.message}</div>
                        <div className="text-2xs text-fg-subtle">{timeAgo(r.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                  {intentWarning.length ? (
                    <Button size="sm" className="mt-2" onClick={() => restart.mutate(d.bot.id)}>
                      Restart bot
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            </div>
          )
        ) : null}
      </ListEditor>
      <p className="text-2xs text-fg-subtle">
        Limits keep automations safe: up to 20 steps, at most 1 hour of waiting per run, and 30 runs per minute per workflow. A run that is waiting when the bot stops is not resumed. Steps between “If” and “End if” run only when the check passes; “Otherwise” steps run when it doesn’t.
      </p>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={d.submit} onDiscard={d.discard} />
    </div>
  );
}

function FlowNode({
  title,
  subtitle,
  tone,
  children,
  open = true,
  onToggle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  tone: 'primary' | 'success' | 'warning' | 'neutral';
  children: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
}) {
  const dot = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', neutral: 'bg-fg-subtle' }[tone];
  return (
    <div className="relative">
      <span className={cn('absolute top-4 -left-[18px] size-2.5 rounded-full ring-4 ring-bg', dot)} />
      <Card>
        <div className="flex items-center gap-2 px-4 py-3">
          <button type="button" className="flex-1 text-left" onClick={onToggle} disabled={!onToggle}>
            <div className="text-sm font-medium text-fg">{title}</div>
            {subtitle && !open ? <div className="text-2xs text-fg-subtle">{subtitle}</div> : null}
          </button>
          {actions}
          {tone === 'primary' ? <Badge tone="primary">Trigger</Badge> : null}
        </div>
        {open ? <div className="border-t border-border px-4 py-4">{children}</div> : null}
      </Card>
    </div>
  );
}
