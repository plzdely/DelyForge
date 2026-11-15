import { hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { useAccount } from '@/lib/account';
import { useAiTroubleshoot } from '@/lib/ai';
import { useEntitlements } from '@/lib/entitlements';
import { UsageLine } from '@/pages/ai-builder';

/** Sends the bot's status and recent (redacted) logs to the AI and shows its diagnosis. */
export function TroubleshootDialog({ botId, onClose }: { botId: string; onClose: () => void }) {
  const signedIn = useAccount().data?.signedIn ?? false;
  const allowed = hasFeature(useEntitlements(), 'ai.troubleshooting');
  const [question, setQuestion] = useState('');
  const ask = useAiTroubleshoot();
  const answer = ask.data?.answer;

  const blocked = !signedIn ? (
    <p className="text-sm text-fg-muted">
      AI help runs on DelyForge’s servers. <Link to="/account" className="text-primary hover:underline">Sign in</Link> to use it.
    </p>
  ) : !allowed ? (
    <p className="text-sm text-fg-muted">
      AI troubleshooting is included in {lowestPlanWithFeature('ai.troubleshooting')?.name ?? 'Pro'}. <Link to="/subscription" className="text-primary hover:underline">View plans</Link>
    </p>
  ) : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ask AI what’s wrong"
      description="Sends the bot’s status and its last 120 log lines. Secrets such as the bot token are removed first."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {blocked ? null : (
            <Button variant="primary" disabled={ask.isPending} onClick={() => ask.mutate({ id: botId, question })}>
              <Sparkles /> {ask.isPending ? 'Looking…' : answer ? 'Ask again' : 'Ask AI'}
            </Button>
          )}
        </>
      }
    >
      {blocked ?? (
        <div className="space-y-4">
          <Field label="Anything specific? (optional)" htmlFor="ts-q">
            <Textarea id="ts-q" rows={2} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Why doesn’t /rank answer?" />
          </Field>
          {ask.error ? <p className="text-sm text-danger">{ask.error.message}</p> : null}
          {answer ? (
            <div className="space-y-2 text-sm">
              <p className="text-fg">{answer.summary}</p>
              <p className="text-fg-muted">
                <span className="font-medium text-fg">Most likely cause:</span> {answer.likelyCause}
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
                {answer.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
          <UsageLine usage={ask.data?.usage} />
        </div>
      )}
    </Dialog>
  );
}
