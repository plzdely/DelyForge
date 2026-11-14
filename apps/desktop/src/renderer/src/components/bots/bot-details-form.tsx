import { BOT_LIMITS } from '@delyforge/shared';
import { Field, Input, Textarea } from '@/components/ui/input';

export interface BotDetailsValues {
  name: string;
  description: string;
  groupName: string;
}

export type BotDetailsErrors = Partial<Record<keyof BotDetailsValues, string>>;

/** Name / description / group fields shared by Create Bot and the bot's settings. */
export function BotDetailsFields({
  values,
  errors,
  onChange,
  groups,
  autoFocus,
}: {
  values: BotDetailsValues;
  errors: BotDetailsErrors;
  onChange: (values: BotDetailsValues) => void;
  groups: string[];
  autoFocus?: boolean;
}) {
  const set = (key: keyof BotDetailsValues) => (e: { target: { value: string } }) =>
    onChange({ ...values, [key]: e.target.value });

  return (
    <div className="space-y-4">
      <Field
        label="Bot name"
        htmlFor="bot-name"
        error={errors.name}
        hint="Shown in DelyForge. You can match it to your bot’s Discord name later."
        counter={{ value: values.name.trim().length, max: BOT_LIMITS.nameMax }}
      >
        <Input
          id="bot-name"
          autoFocus={autoFocus}
          placeholder="e.g. Aurora"
          value={values.name}
          onChange={set('name')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'bot-name-error' : undefined}
        />
      </Field>
      <Field
        label="Description"
        htmlFor="bot-description"
        optional
        error={errors.description}
        counter={{ value: values.description.trim().length, max: BOT_LIMITS.descriptionMax }}
      >
        <Textarea
          id="bot-description"
          placeholder="What does this bot do?"
          value={values.description}
          onChange={set('description')}
          aria-invalid={Boolean(errors.description)}
        />
      </Field>
      <Field
        label="Group"
        htmlFor="bot-group"
        optional
        error={errors.groupName}
        hint="Organize bots by community or client, e.g. “Gaming” or “Client work”."
      >
        <Input
          id="bot-group"
          list="bot-group-options"
          placeholder="No group"
          value={values.groupName}
          onChange={set('groupName')}
          aria-invalid={Boolean(errors.groupName)}
        />
        <datalist id="bot-group-options">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
    </div>
  );
}

/** Maps Zod issues onto the form's fields. */
export function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): BotDetailsErrors {
  const errors: BotDetailsErrors = {};
  for (const issue of issues) {
    const key = issue.path[issue.path.length - 1];
    if ((key === 'name' || key === 'description' || key === 'groupName') && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
