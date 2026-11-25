import { type AiApplyResult, type AiProposalResult, type AiUsageInfo, MODULES, hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { Bot, Check, Lock, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useAccount } from '@/lib/account';
import { useAiBuild, useAiDecision, useAiUsage } from '@/lib/ai';
import { useEntitlements } from '@/lib/entitlements';
import { useGuilds } from '@/lib/modules';
import { useBots } from '@/lib/queries';

const TRIGGERS: Record<string, string> = {
  memberJoin: 'when someone joins',
  memberLeave: 'when someone leaves',
  messageContains: 'when a message contains a keyword',
  roleAdded: 'when a role is added',
  schedule: 'on a schedule',
  reactionAdded: 'when someone reacts',
  memberBoost: 'when someone boosts',
  voiceJoin: 'when someone joins voice',
};
const moduleName = (id: string) => MODULES.find((m) => m.id === id)?.name ?? id;

export function UsageLine({ usage }: { usage: AiUsageInfo | undefined }) {
  if (!usage) return null;
  const left = Math.max(0, usage.limit - usage.used);
  return (
    <p className="text-xs text-fg-subtle tabular-nums">
      {left} of {usage.limit} AI credits left this month · resets {new Date(usage.resetsAt).toLocaleDateString()}
    </p>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <Page route="/builders/ai" width="narrow">
      <PageHeader eyebrow="Builder" title="AI Bot Builder" description="Describe your bot in plain English. You review every change before anything is applied." />
      <Card>{children}</Card>
    </Page>
  );
}

function ProposalView({
  result,
  onApply,
  onDiscard,
  busy,
}: {
  result: AiProposalResult;
  onApply: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const p = result.proposal;
  const empty = !p.modules.length && !p.commands.length && !p.workflows.length;
  return (
    <Card className="mt-4">
      <CardHeader title="Proposed changes" description={`Used ${result.creditsUsed} credit${result.creditsUsed === 1 ? '' : 's'}. Nothing has changed yet.`} />
      <CardBody className="space-y-4 text-sm">
        <p className="text-fg">{p.summary}</p>
        {p.modules.length ? (
          <section>
            <h4 className="mb-1.5 text-xs font-medium text-fg-muted">Modules</h4>
            <ul className="space-y-1">
              {p.modules.map((m) => (
                <li key={m.moduleId} className="flex items-center gap-2">
                  <Badge tone={(m.config as { enabled?: boolean }).enabled ? 'success' : 'neutral'}>{(m.config as { enabled?: boolean }).enabled ? 'On' : 'Off'}</Badge>
                  <span className="text-fg">{moduleName(m.moduleId)}</span>
                  <span className="text-xs text-fg-subtle">settings for this server</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {p.commands.length ? (
          <section>
            <h4 className="mb-1.5 text-xs font-medium text-fg-muted">New commands</h4>
            <ul className="space-y-1">
              {p.commands.map((c) => (
                <li key={`${c.type}:${c.name}`}>
                  <span className="font-mono text-fg">{c.type === 'slash' ? `/${c.name}` : c.name}</span>
                  <span className="text-fg-subtle"> — {c.description || c.response.text.slice(0, 80)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {p.workflows.length ? (
          <section>
            <h4 className="mb-1.5 text-xs font-medium text-fg-muted">New automations</h4>
            <ul className="space-y-1">
              {p.workflows.map((w) => (
                <li key={w.name}>
                  <span className="text-fg">{w.name}</span>
                  <span className="text-fg-subtle"> — {TRIGGERS[w.trigger.type] ?? w.trigger.type}, {w.steps.length} step{w.steps.length === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {p.notes.length ? (
          <section>
            <h4 className="mb-1.5 text-xs font-medium text-fg-muted">Notes</h4>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              {p.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {p.dropped.length ? (
          <section className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-fg-muted">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-fg">
              <TriangleAlert className="size-3.5 text-warning" /> Left out because they didn’t pass checks
            </p>
            <ul className="list-disc pl-5">
              {p.dropped.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="flex gap-2 pt-1">
          <Button variant="primary" onClick={onApply} disabled={busy || empty}>
            <Check /> Apply changes
          </Button>
          <Button onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function AiBuilderPage() {
  const account = useAccount();
  const entitlements = useEntitlements();
  const signedIn = account.data?.signedIn ?? false;
  const allowed = hasFeature(entitlements, 'ai.builder');
  const usage = useAiUsage(signedIn && allowed);
  const bots = (useBots().data ?? []).filter((b) => b.hasToken);
  const [botId, setBotId] = useState('');
  const activeBot = botId || bots[0]?.id || '';
  const guilds = useGuilds(activeBot, Boolean(activeBot));
  const [guildId, setGuildId] = useState('');
  const guild = (guilds.data ?? []).find((g) => g.id === guildId) ?? guilds.data?.[0];
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiProposalResult | null>(null);
  const [applied, setApplied] = useState<AiApplyResult | null>(null);
  const build = useAiBuild();
  const decision = useAiDecision(activeBot);

  if (account.isLoading) return <Page route="/builders/ai" ready={false}>{null}</Page>;
  if (!signedIn) {
    return (
      <Gate>
        <EmptyState icon={Sparkles} title="Sign in to use AI" description="The AI runs on DelyForge’s servers, so it needs your DelyForge account.">
          <Button variant="primary" asChild>
            <Link to="/account">Sign in</Link>
          </Button>
        </EmptyState>
      </Gate>
    );
  }
  if (!allowed) {
    return (
      <Gate>
        <EmptyState icon={Lock} title={`AI is included in ${lowestPlanWithFeature('ai.builder')?.name ?? 'Pro'}`} description="Describe a bot in plain English and get a ready-to-review setup.">
          <Button variant="primary" asChild>
            <Link to="/subscription">View plans</Link>
          </Button>
        </EmptyState>
      </Gate>
    );
  }
  if (!bots.length) {
    return (
      <Gate>
        <EmptyState icon={Bot} title="Connect a bot first" description="The AI sets up one of your bot’s servers, so the bot must be connected and invited.">
          <Button variant="primary" asChild>
            <Link to="/bots">Go to bots</Link>
          </Button>
        </EmptyState>
      </Gate>
    );
  }

  const notConfigured = usage.data && !usage.data.configured;
  const outOfCredits = usage.data && usage.data.used >= usage.data.limit;
  const generate = () =>
    guild &&
    build.mutate(
      { id: activeBot, guildId: guild.id, prompt },
      {
        onSuccess: (r) => {
          setResult(r);
          setApplied(null);
        },
        onError: (e) => toast.error('The AI couldn’t make a proposal', { description: e.message }),
      },
    );
  const apply = () =>
    result &&
    decision.apply.mutate(result.proposalId, {
      onSuccess: (r) => {
        setApplied(r);
        setResult(null);
        toast.success(`Applied ${r.applied.length} change${r.applied.length === 1 ? '' : 's'}`, {
          description: r.restartRequired ? 'Restart the bot so Discord sends it the events the new settings need.' : undefined,
        });
      },
      onError: (e) => toast.error('Couldn’t apply the proposal', { description: e.message }),
    });
  const discard = () => {
    if (result) decision.reject.mutate(result.proposalId);
    setResult(null);
  };

  return (
    <Page route="/builders/ai" width="narrow">
      <PageHeader eyebrow="Builder" title="AI Bot Builder" description="Describe your bot in plain English. You review every change before anything is applied." />
      {notConfigured ? (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-fg-muted">AI isn’t set up on DelyForge’s servers yet. Please try again later.</div>
      ) : null}
      <Card>
        <CardBody className="space-y-4 pt-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bot" htmlFor="ai-bot">
              <Select id="ai-bot" value={activeBot} onChange={(e) => (setBotId(e.target.value), setGuildId(''), setResult(null))}>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Server" htmlFor="ai-guild" hint={guilds.isLoading ? 'Loading servers…' : !guilds.data?.length ? 'Invite the bot to a server first.' : undefined}>
              <Select id="ai-guild" value={guild?.id ?? ''} onChange={(e) => (setGuildId(e.target.value), setResult(null))} disabled={!guilds.data?.length}>
                {(guilds.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="What should your bot do?" htmlFor="ai-prompt" hint="For example: “Welcome new members in #welcome, give them the Member role, and add a /rules command.”">
            <Textarea id="ai-prompt" rows={4} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <UsageLine usage={usage.data} />
            <Button variant="primary" onClick={generate} disabled={!guild || prompt.trim().length < 10 || build.isPending || Boolean(notConfigured) || Boolean(outOfCredits)}>
              <Sparkles /> {build.isPending ? 'Thinking… (up to a minute)' : 'Generate proposal'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {result ? <ProposalView result={result} onApply={apply} onDiscard={discard} busy={decision.apply.isPending} /> : null}

      {applied ? (
        <Card className="mt-4">
          <CardHeader title="Done" description="You can fine-tune everything in the bot’s Modules, Commands and Automations tabs." />
          <CardBody className="space-y-2 text-sm">
            <ul className="space-y-1">
              {applied.applied.map((a) => (
                <li key={a} className="flex items-center gap-2 text-fg">
                  <Check className="size-3.5 text-success" /> {a}
                </li>
              ))}
            </ul>
            {applied.skipped.length ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
                {applied.skipped.map((s) => (
                  <li key={s}>Skipped: {s}</li>
                ))}
              </ul>
            ) : null}
            <Button size="sm" asChild>
              <Link to={`/bots/${activeBot}/modules`}>Open the bot’s modules</Link>
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </Page>
  );
}
