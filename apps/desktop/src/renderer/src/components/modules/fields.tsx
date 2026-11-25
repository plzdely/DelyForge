import { DiscordMessage } from '@/components/builders/discord-preview';
import { type GuildInfo, type LinkButton, TEMPLATE_VARIABLES, renderTemplate } from '@delyforge/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

type Variable = { key: string; description: string };

/** Message box with clickable {variables} and a live preview. */
export function TemplateField({
  id,
  label,
  value,
  onChange,
  max = 2000,
  variables = TEMPLATE_VARIABLES,
  sample = {},
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  variables?: readonly Variable[];
  sample?: Record<string, string | number>;
}) {
  const preview = renderTemplate(value, {
    user: '@NewMember',
    'user.name': 'NewMember',
    'user.id': '123456789012345678',
    server: 'Your Server',
    memberCount: 128,
    ...sample,
  });
  return (
    <Field label={label} htmlFor={id} counter={{ value: value.length, max }}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-24" />
      <div className="flex flex-wrap gap-1.5">
        {variables.map((v) => (
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
      {value ? (
        <div aria-label="Preview">
          <div className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">Preview</div>
          <DiscordMessage botName="Your bot" text={preview} />
        </div>
      ) : null}
    </Field>
  );
}

/** One role, chosen from the server's roles. `assignableOnly` disables roles the bot cannot give. */
export function RoleSelect({
  id,
  label,
  hint,
  guild,
  value,
  onChange,
  assignableOnly,
  allowNone = true,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  guild: GuildInfo;
  value: string | null;
  onChange: (v: string | null) => void;
  assignableOnly?: boolean;
  allowNone?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {allowNone ? <option value="">— None —</option> : null}
        {guild.roles.map((r) => {
          const blocked = assignableOnly && (r.managed || r.position >= guild.botRolePosition);
          return (
            <option key={r.id} value={r.id} disabled={blocked && r.id !== value}>
              @{r.name}
              {blocked ? ' (bot can’t give this role)' : ''}
            </option>
          );
        })}
      </Select>
    </Field>
  );
}

/** A channel category (for ticket channels). */
export function CategorySelect({ id, label, hint, guild, value, onChange }: { id: string; label: string; hint?: ReactNode; guild: GuildInfo; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— No category —</option>
        {guild.channels
          .filter((c) => c.kind === 'category')
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </Select>
    </Field>
  );
}

/** Link buttons shown under a message (e.g. "Read the rules" → a web page). */
export function LinkButtonsEditor({ id, value, onChange, max = 3 }: { id: string; value: LinkButton[]; onChange: (v: LinkButton[]) => void; max?: number }) {
  const update = (n: number, patch: Partial<LinkButton>) => onChange(value.map((b, i) => (i === n ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {value.map((b, n) => (
        <div key={n} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
          <Field label="Button label" htmlFor={`${id}-label-${n}`}>
            <Input id={`${id}-label-${n}`} maxLength={80} value={b.label} onChange={(e) => update(n, { label: e.target.value })} />
          </Field>
          <Field label="Opens this link" htmlFor={`${id}-url-${n}`}>
            <Input id={`${id}-url-${n}`} maxLength={2048} placeholder="https://" value={b.url} onChange={(e) => update(n, { url: e.target.value })} />
          </Field>
          <Button size="icon" variant="ghost" aria-label="Remove button" onClick={() => onChange(value.filter((_, i) => i !== n))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      {value.length < max ? (
        <Button size="sm" onClick={() => onChange([...value, { label: 'Read the rules', url: 'https://' }])}>
          <Plus /> Add a link button
        </Button>
      ) : null}
    </div>
  );
}
