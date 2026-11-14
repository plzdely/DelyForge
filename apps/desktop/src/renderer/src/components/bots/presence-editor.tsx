import type { BotPresence } from '@delyforge/shared';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const STATUSES: { value: BotPresence['status']; label: string }[] = [
  { value: 'online', label: '🟢 Online' },
  { value: 'idle', label: '🌙 Idle' },
  { value: 'dnd', label: '⛔ Do Not Disturb' },
  { value: 'invisible', label: '⚪ Invisible (appears offline)' },
];

const ACTIVITY_TYPES = [
  { value: 'none', label: 'No activity' },
  { value: 'playing', label: 'Playing …' },
  { value: 'listening', label: 'Listening to …' },
  { value: 'watching', label: 'Watching …' },
  { value: 'competing', label: 'Competing in …' },
  { value: 'custom', label: 'Custom status' },
] as const;

/** Edits the bot's status and "Playing / Watching …" activity. */
export function PresenceEditor({
  value,
  onChange,
  error,
}: {
  value: BotPresence;
  onChange: (value: BotPresence) => void;
  error?: string;
}) {
  const activityType = value.activity?.type ?? 'none';
  const preview = value.activity
    ? value.activity.type === 'custom'
      ? value.activity.text
      : `${{ playing: 'Playing', listening: 'Listening to', watching: 'Watching', competing: 'Competing in' }[value.activity.type]} ${value.activity.text}`
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status" htmlFor="presence-status">
          <Select
            id="presence-status"
            value={value.status}
            onChange={(e) => onChange({ ...value, status: e.target.value as BotPresence['status'] })}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Activity" htmlFor="presence-activity">
          <Select
            id="presence-activity"
            value={activityType}
            onChange={(e) => {
              const type = e.target.value as (typeof ACTIVITY_TYPES)[number]['value'];
              onChange({ ...value, activity: type === 'none' ? null : { type, text: value.activity?.text ?? '' } });
            }}
          >
            {ACTIVITY_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {value.activity ? (
        <Field
          label={value.activity.type === 'custom' ? 'Status text' : 'Activity text'}
          htmlFor="presence-text"
          error={error}
          counter={{ value: value.activity.text.length, max: 128 }}
          hint={preview ? `Members will see: “${preview}”` : undefined}
        >
          <Input
            id="presence-text"
            placeholder={value.activity.type === 'custom' ? 'Helping the community 💜' : 'with commands'}
            value={value.activity.text}
            onChange={(e) => onChange({ ...value, activity: { type: value.activity!.type, text: e.target.value } })}
            aria-invalid={Boolean(error)}
          />
        </Field>
      ) : null}
    </div>
  );
}
