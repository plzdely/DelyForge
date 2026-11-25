import type { GuildChannelKind, GuildInfo } from '@delyforge/shared';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';

/** Choose which of the bot's servers you are configuring. */
export function GuildPicker({
  guilds,
  value,
  onChange,
  onRefresh,
  refreshing,
}: {
  guilds: GuildInfo[];
  value: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const current = guilds.find((g) => g.id === value);
  return (
    <div className="flex items-center gap-2">
      {current?.iconUrl ? <img src={current.iconUrl} alt="" className="size-8 rounded-lg" /> : null}
      <Select aria-label="Server" value={value} onChange={(e) => onChange(e.target.value)} className="w-64">
        {guilds.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <Button variant="ghost" size="icon" aria-label="Reload servers, channels and roles from Discord" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={cn(refreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

/** Text / announcement channels grouped under their categories. */
export function ChannelSelect({
  guild,
  value,
  onChange,
  id,
  label,
  hint,
  error,
  emptyLabel = '— Choose a channel —',
  kinds = ['text', 'announcement'],
}: {
  guild: GuildInfo;
  value: string | null;
  onChange: (id: string | null) => void;
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** What "no channel" means here. */
  emptyLabel?: string;
  /** Which kinds of channel can be picked (text channels by default). */
  kinds?: readonly GuildChannelKind[];
}) {
  const textual = guild.channels.filter((c) => kinds.includes(c.kind));
  const categories = guild.channels.filter((c) => c.kind === 'category');
  const groups = [
    { name: null as string | null, items: textual.filter((c) => !c.parentId) },
    ...categories.map((cat) => ({ name: cat.name, items: textual.filter((c) => c.parentId === cat.id) })),
  ].filter((g) => g.items.length);
  const missing = value !== null && !textual.some((c) => c.id === value);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error ?? (missing ? 'This channel no longer exists — pick another.' : undefined)}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{emptyLabel}</option>
        {groups.map((g) =>
          g.name ? (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind === 'voice' ? '🔊' : '#'} {c.name}
                </option>
              ))}
            </optgroup>
          ) : (
            g.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === 'voice' ? '🔊' : '#'} {c.name}
              </option>
            ))
          ),
        )}
      </Select>
    </Field>
  );
}

/** Multi-select list of roles. Roles the bot cannot assign are shown but disabled, with the reason. */
export function RoleChecklist({
  guild,
  value,
  onChange,
  assignableOnly,
  max = 25,
}: {
  guild: GuildInfo;
  value: string[];
  onChange: (ids: string[]) => void;
  /** For roles the bot must give out (auto-roles): disable managed roles and roles above the bot. */
  assignableOnly?: boolean;
  max?: number;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id].slice(0, max));
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-border-strong bg-bg-subtle p-1">
      {guild.roles.length === 0 ? <p className="p-2 text-xs text-fg-subtle">This server has no roles yet.</p> : null}
      {guild.roles.map((r) => {
        const reason = !assignableOnly ? null : r.managed ? 'managed by an integration' : r.position >= guild.botRolePosition ? 'above the bot’s role' : null;
        const color = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'var(--df-fg-subtle)';
        return (
          <label
            key={r.id}
            className={cn('flex items-center gap-2 rounded px-2 py-1.5 text-sm', reason ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-hover')}
          >
            <input type="checkbox" className="accent-[var(--df-primary)]" checked={value.includes(r.id)} disabled={Boolean(reason) && !value.includes(r.id)} onChange={() => toggle(r.id)} />
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate text-fg">{r.name}</span>
            {reason ? <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{reason}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/** One item per line (blocked words, allowed domains). */
export function LinesInput({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <textarea
        id={id}
        className="min-h-24 w-full resize-y rounded-md border border-border-strong bg-bg-subtle px-3 py-2 font-mono text-xs text-fg outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--df-primary-soft)]"
        placeholder={placeholder}
        value={value.join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
      />
    </Field>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
          className="h-9 w-24 rounded-md border border-border-strong bg-bg-subtle px-3 text-sm text-fg tabular-nums outline-none focus:border-primary"
        />
        {suffix ? <span className="text-xs text-fg-subtle">{suffix}</span> : null}
      </div>
    </Field>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  badge,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          {title}
          {badge}
        </div>
        {description ? <div className="mt-0.5 text-xs text-fg-subtle">{description}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </div>
  );
}

/** Multi-select list of text channels (e.g. channels logging should ignore). */
export function ChannelChecklist({ guild, value, onChange }: { guild: GuildInfo; value: string[]; onChange: (ids: string[]) => void }) {
  const channels = guild.channels.filter((c) => c.kind === 'text' || c.kind === 'announcement');
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border border-border-strong bg-bg-subtle p-1">
      {channels.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-hover">
          <input
            type="checkbox"
            className="accent-[var(--df-primary)]"
            checked={value.includes(c.id)}
            onChange={() => onChange(value.includes(c.id) ? value.filter((v) => v !== c.id) : [...value, c.id])}
          />
          <span className="text-fg-muted">#</span>
          <span className="truncate text-fg">{c.name}</span>
        </label>
      ))}
    </div>
  );
}
