import { type BotPresence, type BotProject, presenceSchema, updateBotProjectSchema } from '@delyforge/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  type BotDetailsErrors,
  type BotDetailsValues,
  BotDetailsFields,
  issuesToErrors,
} from '@/components/bots/bot-details-form';
import { PermissionsEditor } from '@/components/bots/permissions-editor';
import { PresenceEditor } from '@/components/bots/presence-editor';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { call } from '@/lib/bridge';
import { timeAgo } from '@/lib/format';
import { queryKeys, useUpdateBot } from '@/lib/queries';
import { useBotContext } from './layout';

const toValues = (b: BotProject): BotDetailsValues => ({
  name: b.name,
  description: b.description,
  groupName: b.groupName ?? '',
});

function SaveBar({ dirty, busy, onDiscard }: { dirty: boolean; busy: boolean; onDiscard: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
      {dirty ? <span className="mr-auto text-xs text-fg-subtle">Unsaved changes</span> : null}
      <Button disabled={!dirty || busy} onClick={onDiscard}>
        Discard
      </Button>
      <Button type="submit" variant="primary" disabled={!dirty || busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );
}

function GeneralSettings({ bot, groups }: { bot: BotProject; groups: string[] }) {
  const update = useUpdateBot();
  const [values, setValues] = useState(() => toValues(bot));
  const [errors, setErrors] = useState<BotDetailsErrors>({});
  const saved = toValues(bot);
  const dirty =
    values.name.trim() !== saved.name || values.description.trim() !== saved.description || values.groupName.trim() !== saved.groupName;

  // Pick up changes made elsewhere without losing unsaved edits.
  useEffect(() => {
    if (!dirty) setValues(toValues(bot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.updatedAt]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateBotProjectSchema.safeParse({
      id: bot.id,
      patch: { name: values.name, description: values.description, groupName: values.groupName },
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    update.mutate(parsed.data, {
      onSuccess: (next) => {
        setValues(toValues(next));
        toast.success('Changes saved');
      },
      onError: (err) => toast.error('Could not save', { description: err.message }),
    });
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader title="General" description="How this project appears in DelyForge." />
        <CardBody>
          <BotDetailsFields values={values} errors={errors} onChange={setValues} groups={groups} />
        </CardBody>
        <SaveBar dirty={dirty} busy={update.isPending} onDiscard={() => (setValues(saved), setErrors({}))} />
      </form>
    </Card>
  );
}

function PresenceSettings({ bot }: { bot: BotProject }) {
  const update = useUpdateBot();
  const [presence, setPresence] = useState<BotPresence>(bot.presence);
  const [error, setError] = useState<string>();
  const dirty = JSON.stringify(presence) !== JSON.stringify(bot.presence);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = presenceSchema.safeParse(presence);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    update.mutate(
      { id: bot.id, patch: { presence: parsed.data } },
      {
        onSuccess: () => toast.success('Presence saved', { description: 'Applied immediately if the bot is online.' }),
        onError: (err) => toast.error('Could not save', { description: err.message }),
      },
    );
  };
  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader title="Presence" description="The status and activity members see on your bot." />
        <CardBody>
          <PresenceEditor value={presence} onChange={setPresence} error={error} />
        </CardBody>
        <SaveBar dirty={dirty} busy={update.isPending} onDiscard={() => setPresence(bot.presence)} />
      </form>
    </Card>
  );
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div>
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-xs text-fg-subtle">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function BehaviorSettings({ bot }: { bot: BotProject }) {
  const update = useUpdateBot();
  const set = (patch: { autoStart?: boolean; autoRestart?: boolean; builtinPing?: boolean }) =>
    update.mutate({ id: bot.id, patch }, { onError: (err) => toast.error('Could not save', { description: err.message }) });
  return (
    <Card>
      <CardHeader title="Behavior" />
      <Separator />
      <ToggleRow
        title="Start when DelyForge opens"
        description="Bots run while DelyForge is open on this computer. Cloud hosting for 24/7 bots is planned."
        checked={bot.autoStart}
        onChange={(v) => set({ autoStart: v })}
      />
      <Separator />
      <ToggleRow
        title="Restart automatically after a crash"
        description="Waits a little longer after each crash and pauses if the bot keeps crashing."
        checked={bot.autoRestart}
        onChange={(v) => set({ autoRestart: v })}
      />
      <Separator />
      <ToggleRow
        title="/ping test command"
        description="Registered when the bot starts. Turning this off stops answering /ping (Discord keeps listing it until removed)."
        checked={bot.builtinPing}
        onChange={(v) => set({ builtinPing: v })}
      />
    </Card>
  );
}

function PermissionSettings({ bot }: { bot: BotProject }) {
  const update = useUpdateBot();
  return (
    <Card>
      <CardHeader title="Invite permissions" description="Used for new invite links. Servers that already added the bot keep the permissions they granted." />
      <CardBody>
        <PermissionsEditor
          value={bot.permissions}
          onChange={(permissions) =>
            update.mutate({ id: bot.id, patch: { permissions } }, { onError: (err) => toast.error('Could not save', { description: err.message }) })
          }
        />
      </CardBody>
    </Card>
  );
}

function IntentRow({ label, on, help }: { label: string; on: boolean; help: string }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {on ? <Check className="mt-px size-3.5 shrink-0 text-success" /> : <Minus className="mt-px size-3.5 shrink-0 text-fg-subtle" />}
      <span>
        <span className="text-fg">{label}</span> <span className="text-fg-subtle">— {on ? 'enabled in the portal' : help}</span>
      </span>
    </li>
  );
}

function DiscordSettings({ bot }: { bot: BotProject }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => call((b) => b.bots.disconnect(bot.id)),
    onSuccess: (p) => {
      qc.setQueryData(queryKeys.bot(bot.id), p);
      void qc.invalidateQueries({ queryKey: queryKeys.bots });
      setConfirm(false);
      toast.success('Disconnected from Discord', { description: 'The token was deleted from this computer.' });
    },
    onError: (err) => toast.error('Could not disconnect', { description: err.message }),
  });

  return (
    <Card>
      <CardHeader title="Discord connection" />
      <CardBody>
        {bot.hasToken ? (
          <>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-subtle">Bot account</dt>
                <dd className="text-fg">{bot.botUsername ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-subtle">Application ID</dt>
                <dd className="font-mono text-fg-muted" data-selectable>{bot.discordApplicationId}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-subtle">Token</dt>
                <dd className="font-mono text-fg-muted">{bot.tokenHint} · encrypted on this PC</dd>
              </div>
            </dl>
            {bot.privilegedIntents ? (
              <>
                <div className="mt-4 mb-2 text-2xs font-medium tracking-[0.06em] text-fg-subtle uppercase">Privileged intents</div>
                <ul className="space-y-1.5">
                  <IntentRow label="Server Members" on={bot.privilegedIntents.GuildMembers} help="needed later for welcome messages & auto-roles" />
                  <IntentRow label="Message Content" on={bot.privilegedIntents.MessageContent} help="needed later for word filters & leveling" />
                  <IntentRow label="Presence" on={bot.privilegedIntents.GuildPresences} help="rarely needed" />
                </ul>
                <p className="mt-2 text-2xs text-fg-subtle">Your bot currently needs none of these. Modules will tell you if they do.</p>
              </>
            ) : null}
            <div className="mt-4 flex gap-2">
              <Button size="sm" asChild>
                <Link to="../connect">Replace token</Link>
              </Button>
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm(true)}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted">Not connected yet.</p>
            <Button size="sm" variant="primary" asChild>
              <Link to="../connect">Connect to Discord</Link>
            </Button>
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect from Discord?"
        description="The bot will stop and its token will be deleted from this computer. The bot stays in your servers; you can reconnect it any time with its token."
        confirmLabel="Disconnect"
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Card>
  );
}

export function BotSettings() {
  const { bot, groups, actions } = useBotContext();
  return (
    <div className="grid grid-cols-3 gap-3" data-route-ready={`/bots/${bot.id}/settings`}>
      <div className="col-span-2 space-y-3">
        <GeneralSettings key={bot.id} bot={bot} groups={groups} />
        <PresenceSettings key={`p-${bot.id}`} bot={bot} />
        <PermissionSettings bot={bot} />
      </div>
      <div className="space-y-3">
        <DiscordSettings bot={bot} />
        <BehaviorSettings bot={bot} />
        <Card>
          <CardHeader title="Project" />
          <Separator />
          <dl className="space-y-2.5 px-5 py-4 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-fg-subtle">Created</dt>
              <dd className="text-fg-muted">{timeAgo(bot.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-fg-subtle">Project ID</dt>
              <dd className="truncate font-mono text-2xs leading-4 text-fg-muted" data-selectable title={bot.id}>
                {bot.id}
              </dd>
            </div>
          </dl>
          <Separator />
          <div className="px-5 py-3">
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => actions.requestDelete(bot)}>
              Delete project…
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
