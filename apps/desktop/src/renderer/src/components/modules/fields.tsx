import { type GuildInfo, TEMPLATE_VARIABLES, renderTemplate } from '@delyforge/shared';
import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
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
      {value ? <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs whitespace-pre-wrap text-fg-muted">Preview: {preview}</div> : null}
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
