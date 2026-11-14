import {
  type BotPresence,
  type BotProject,
  DEVELOPER_PORTAL_URL,
  checkTokenShape,
  presenceSchema,
} from '@delyforge/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Lock, Play, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PermissionsEditor, InviteLink } from '@/components/bots/permissions-editor';
import { PresenceEditor } from '@/components/bots/presence-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { call } from '@/lib/bridge';
import { queryKeys, useUpdateBot } from '@/lib/queries';
import { useRuntimeControls } from '@/lib/runtime';
import { useBotContext } from './layout';

const STEPS = ['Create application', 'Add the token', 'Invite to a server', 'Go live'] as const;

function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded border border-border-strong bg-surface-hover px-1.5 py-px text-xs font-medium text-fg">{children}</span>;
}

function Instructions({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm text-fg-muted">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-2xs font-semibold text-fg">
            {i + 1}
          </span>
          <span className="leading-5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function openPortal() {
  void call((b) => b.shell.openExternal(DEVELOPER_PORTAL_URL)).catch((e: Error) =>
    toast.error('Could not open your browser', { description: e.message }),
  );
}

function StepCreate({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h2 className="text-base font-semibold text-fg">Create a Discord application</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Every Discord bot belongs to an “application” in Discord’s Developer Portal. It’s free and takes a minute. Already
        have one? Skip to the next step.
      </p>
      <div className="mt-5">
        <Instructions
          items={[
            <>Open the Developer Portal and sign in with your Discord account.</>,
            <>
              Click <Kbd>New Application</Kbd> (top right), type your bot’s name, accept Discord’s terms and click <Kbd>Create</Kbd>.
            </>,
            <>
              Optional: on <Kbd>General Information</Kbd> upload an icon and description — this becomes your bot’s avatar.
            </>,
          ]}
        />
      </div>
      <div className="mt-6 flex justify-between">
        <Button onClick={openPortal}>
          <ExternalLink /> Open Developer Portal
        </Button>
        <Button variant="primary" onClick={onNext}>
          I have an application
        </Button>
      </div>
    </>
  );
}

function StepToken({ bot, onNext }: { bot: BotProject; onNext: () => void }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: (t: string) => call((b) => b.bots.connect(bot.id, t)),
    onSuccess: (project) => {
      setToken(''); // never keep the token in the UI longer than needed
      qc.setQueryData(queryKeys.bot(bot.id), project);
      void qc.invalidateQueries({ queryKey: queryKeys.bots });
      toast.success(`Connected as ${project.botUsername}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const check = checkTokenShape(token);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    connect.mutate(check.token);
  };

  if (bot.hasToken && !connect.isPending) {
    return (
      <>
        <h2 className="text-base font-semibold text-fg">Connected</h2>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-success/30 bg-success-soft p-4">
          {bot.botAvatarUrl ? (
            <img src={bot.botAvatarUrl} alt="" className="size-10 rounded-full" />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-full bg-success/20">
              <Check className="size-5 text-success" />
            </span>
          )}
          <div>
            <div className="text-sm font-medium text-fg">{bot.botUsername}</div>
            <div className="text-xs text-fg-muted">
              Token {bot.tokenHint} saved securely on this computer · Application {bot.discordApplicationId}
            </div>
          </div>
        </div>
        <TokenForm token={token} setToken={setToken} show={show} setShow={setShow} error={error} submit={submit} busy={connect.isPending} label="Replace token" />
        <div className="mt-6 flex justify-end">
          <Button variant="primary" onClick={onNext}>
            Continue
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className="text-base font-semibold text-fg">Add your bot token</h2>
      <p className="mt-1 text-sm text-fg-muted">The token is the password your bot uses to log in to Discord.</p>
      <div className="mt-5">
        <Instructions
          items={[
            <>
              In your application, click <Kbd>Bot</Kbd> in the left menu.
            </>,
            <>
              Click <Kbd>Reset Token</Kbd>, confirm, and then <Kbd>Copy</Kbd>. Discord only shows a token once — if you lose it,
              just reset it again.
            </>,
            <>Paste it below.</>,
          ]}
        />
      </div>
      <div className="mt-4 flex gap-2.5 rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-xs text-fg-muted">
        <ShieldCheck className="mt-px size-4 shrink-0 text-success" />
        Treat your token like a password and never share it. DelyForge encrypts it with Windows’ secure storage, keeps it
        on this computer only, and never shows it again.
      </div>
      <TokenForm token={token} setToken={setToken} show={show} setShow={setShow} error={error} submit={submit} busy={connect.isPending} label="Verify & save" />
      <div className="mt-4">
        <Button variant="link" size="sm" onClick={openPortal}>
          Open Developer Portal <ExternalLink className="size-3" />
        </Button>
      </div>
    </>
  );
}

function TokenForm(props: {
  token: string;
  setToken: (v: string) => void;
  show: boolean;
  setShow: (v: boolean) => void;
  error: string | null;
  submit: (e: FormEvent) => void;
  busy: boolean;
  label: string;
}) {
  return (
    <form onSubmit={props.submit} noValidate className="mt-5">
      <Field label="Bot token" htmlFor="bot-token" error={props.error ?? undefined}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="bot-token"
              type={props.show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your bot token"
              className="pr-9 pl-8 font-mono text-xs"
              value={props.token}
              onChange={(e) => props.setToken(e.target.value)}
              aria-invalid={Boolean(props.error)}
              aria-describedby={props.error ? 'bot-token-error' : undefined}
            />
            <button
              type="button"
              aria-label={props.show ? 'Hide token' : 'Show token'}
              onClick={() => props.setShow(!props.show)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg"
            >
              {props.show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button type="submit" variant="primary" size="lg" disabled={props.busy || props.token.trim() === ''} data-testid="verify-token">
            {props.busy ? 'Checking with Discord…' : props.label}
          </Button>
        </div>
      </Field>
    </form>
  );
}

function StepInvite({ bot, onNext }: { bot: BotProject; onNext: () => void }) {
  const update = useUpdateBot();
  const [permissions, setPermissions] = useState(bot.permissions);
  const save = (next: string) => {
    setPermissions(next);
    update.mutate({ id: bot.id, patch: { permissions: next } }, { onError: (e) => toast.error('Could not save', { description: e.message }) });
  };
  return (
    <>
      <h2 className="text-base font-semibold text-fg">Invite your bot to a server</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Choose what your bot is allowed to do, then open the invite link and pick a server you manage. You need the
        “Manage Server” permission there.
      </p>
      <div className="mt-5">
        <PermissionsEditor value={permissions} onChange={save} />
      </div>
      {bot.discordApplicationId ? (
        <div className="mt-5">
          <InviteLink applicationId={bot.discordApplicationId} permissions={permissions} />
        </div>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </div>
    </>
  );
}

function StepLive({ bot }: { bot: BotProject }) {
  const navigate = useNavigate();
  const update = useUpdateBot();
  const { start } = useRuntimeControls();
  const [presence, setPresence] = useState<BotPresence>(bot.presence);
  const [builtinPing, setBuiltinPing] = useState(bot.builtinPing);
  const [autoStart, setAutoStart] = useState(bot.autoStart);
  const [error, setError] = useState<string | undefined>();

  const goLive = () => {
    const parsed = presenceSchema.safeParse(presence);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    update.mutate(
      { id: bot.id, patch: { presence: parsed.data, builtinPing, autoStart } },
      {
        onSuccess: () =>
          start.mutate(bot.id, {
            onSuccess: () => {
              toast.success(`${bot.name} is starting`);
              navigate(`/bots/${bot.id}`);
            },
          }),
        onError: (e) => toast.error('Could not save', { description: e.message }),
      },
    );
  };

  return (
    <>
      <h2 className="text-base font-semibold text-fg">Go live</h2>
      <p className="mt-1 text-sm text-fg-muted">Set how your bot appears in Discord, then start it.</p>
      <div className="mt-5">
        <PresenceEditor value={presence} onChange={setPresence} error={error} />
      </div>
      <div className="mt-5 space-y-3 rounded-lg border border-border p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm text-fg">Add a /ping test command</span>
            <span className="block text-xs text-fg-subtle">Type /ping in your server to check the bot answers. Adds only this one command.</span>
          </span>
          <Switch checked={builtinPing} onCheckedChange={setBuiltinPing} aria-label="Add /ping command" />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm text-fg">Start when DelyForge opens</span>
            <span className="block text-xs text-fg-subtle">Bots run while DelyForge is open on this computer.</span>
          </span>
          <Switch checked={autoStart} onCheckedChange={setAutoStart} aria-label="Start when DelyForge opens" />
        </label>
      </div>
      <div className="mt-6 flex justify-end">
        <Button variant="primary" size="lg" onClick={goLive} disabled={update.isPending || start.isPending}>
          <Play className="fill-current" /> Start bot
        </Button>
      </div>
    </>
  );
}

export function ConnectWizard() {
  const { bot } = useBotContext();
  const [step, setStep] = useState(bot.hasToken ? 2 : 0);

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4" data-route-ready={`/bots/${bot.id}/connect`}>
      <nav aria-label="Setup steps" className="space-y-1">
        {STEPS.map((label, i) => {
          const locked = i >= 2 && !bot.hasToken;
          const done = i < step || (i === 1 && bot.hasToken);
          return (
            <button
              key={label}
              type="button"
              disabled={locked}
              onClick={() => setStep(i)}
              aria-current={step === i ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                step === i ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover/60',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-2xs font-semibold',
                  done ? 'bg-primary text-primary-fg' : step === i ? 'border border-primary text-primary' : 'border border-border-strong text-fg-subtle',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              {label}
              {locked ? <Lock className="ml-auto size-3 text-fg-subtle" /> : null}
            </button>
          );
        })}
        <div className="px-3 pt-3">
          <Badge tone="neutral">No code required</Badge>
        </div>
      </nav>
      <Card className="p-6">
        {step === 0 ? <StepCreate onNext={() => setStep(1)} /> : null}
        {step === 1 ? <StepToken bot={bot} onNext={() => setStep(2)} /> : null}
        {step === 2 ? <StepInvite bot={bot} onNext={() => setStep(3)} /> : null}
        {step === 3 ? <StepLive bot={bot} /> : null}
      </Card>
    </div>
  );
}
