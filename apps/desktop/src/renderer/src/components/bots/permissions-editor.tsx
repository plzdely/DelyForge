import { PERMISSIONS, PERMISSION_PRESETS, buildInviteUrl } from '@delyforge/shared';
import { Check, Copy, ExternalLink, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { call } from '@/lib/bridge';

const GROUPS = [
  { id: 'basic', label: 'Messaging' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'management', label: 'Server management' },
  { id: 'dangerous', label: 'Dangerous' },
] as const;

const PRESETS = [
  { id: 'basic', label: 'Basic', text: 'Chat, embeds and reactions' },
  { id: 'moderation', label: 'Moderation', text: 'Adds kick, ban, timeout and message management' },
  { id: 'full', label: 'Full community', text: 'Adds roles, channels and threads (for tickets, auto-roles)' },
] as const;

/** Choose what the bot may do in a server. Pick a preset or fine-tune individual permissions. */
export function PermissionsEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const bits = BigInt(value);
  const toggle = (bit: bigint) => onChange(((bits & bit) !== 0n ? bits & ~bit : bits | bit).toString());
  const admin = PERMISSIONS.find((p) => p.key === 'Administrator')!;
  const activePreset = PRESETS.find((p) => PERMISSION_PRESETS[p.id] === bits)?.id;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Permission preset">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={activePreset === p.id}
            onClick={() => onChange(PERMISSION_PRESETS[p.id].toString())}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              activePreset === p.id ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
            )}
          >
            <div className="flex items-center justify-between text-sm font-medium text-fg">
              {p.label}
              {activePreset === p.id ? <Check className="size-3.5 text-primary" /> : null}
            </div>
            <div className="mt-0.5 text-xs text-fg-subtle">{p.text}</div>
          </button>
        ))}
      </div>

      <details className="group rounded-lg border border-border">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-fg-muted select-none hover:text-fg">
          Customize individual permissions <span className="text-fg-subtle">({activePreset ? 'using preset' : 'custom'})</span>
        </summary>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border p-4">
          {GROUPS.map((g) => (
            <fieldset key={g.id}>
              <legend className="mb-1.5 text-2xs font-medium tracking-[0.06em] text-fg-subtle uppercase">{g.label}</legend>
              <div className="space-y-1">
                {PERMISSIONS.filter((p) => p.group === g.id).map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[var(--df-primary)]"
                      checked={(bits & p.bit) !== 0n}
                      onChange={() => toggle(p.bit)}
                    />
                    <span>
                      <span className={cn('block text-xs', p.group === 'dangerous' ? 'text-danger' : 'text-fg')}>{p.label}</span>
                      <span className="block text-2xs leading-4 text-fg-subtle">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </details>

      {(bits & admin.bit) !== 0n ? (
        <div className="flex gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-fg-muted">
          <TriangleAlert className="mt-px size-4 shrink-0 text-danger" />
          Administrator gives the bot every permission. If its token ever leaks, an attacker gets full control of your
          server. Prefer a preset.
        </div>
      ) : null}
    </div>
  );
}

/** Invite link with Copy / Open buttons. */
export function InviteLink({ applicationId, permissions }: { applicationId: string; permissions: string }) {
  const url = buildInviteUrl(applicationId, permissions);
  return (
    <div className="space-y-2">
      <div
        className="truncate rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-2xs text-fg-muted"
        data-selectable
        title={url}
      >
        {url}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            call((b) => b.clipboard.writeText(url))
              .then(() => toast.success('Invite link copied'))
              .catch((e: Error) => toast.error('Could not copy', { description: e.message }))
          }
        >
          <Copy /> Copy link
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => call((b) => b.shell.openExternal(url)).catch((e: Error) => toast.error('Could not open browser', { description: e.message }))}
        >
          <ExternalLink /> Open invite in browser
        </Button>
      </div>
    </div>
  );
}
