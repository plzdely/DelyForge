import { DEFAULT_PLANS, createBotProjectSchema, isWithinLimit } from '@delyforge/shared';
import { ArrowLeft, Lock, Plug, Puzzle, Rocket } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  type BotDetailsErrors,
  type BotDetailsValues,
  BotDetailsFields,
  issuesToErrors,
} from '@/components/bots/bot-details-form';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, IconTile } from '@/components/ui/misc';
import { useEntitlements } from '@/lib/entitlements';
import { useBots, useCreateBot } from '@/lib/queries';

const NEXT_STEPS = [
  { icon: Plug, title: 'Connect to Discord', text: 'Link your bot token and invite your bot to a server.', phase: 3 },
  { icon: Puzzle, title: 'Add modules', text: 'Moderation, welcome messages, tickets, leveling and more.', phase: 4 },
  { icon: Rocket, title: 'Go live', text: 'Start the bot and watch it in real time.', phase: 3 },
];

export function CreateBotPage() {
  const navigate = useNavigate();
  const bots = useBots();
  const create = useCreateBot();
  const entitlements = useEntitlements();
  const [values, setValues] = useState<BotDetailsValues>({ name: '', description: '', groupName: '' });
  const [errors, setErrors] = useState<BotDetailsErrors>({});

  const count = bots.data?.length ?? 0;
  const canAdd = isWithinLimit(entitlements, 'maxBotProjects', count + 1);
  const plan = DEFAULT_PLANS[entitlements.effectivePlanId];
  const groups = useMemo(
    () => [...new Set((bots.data ?? []).map((b) => b.groupName).filter((g): g is string => g !== null))],
    [bots.data],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = createBotProjectSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (bot) => {
        toast.success(`“${bot.name}” created`);
        navigate(`/bots/${bot.id}`);
      },
      onError: (err) => toast.error('Could not create bot', { description: (err as Error).message }),
    });
  };

  return (
    <Page route="/bots/new" ready={!bots.isLoading} width="narrow">
      <PageHeader
        eyebrow={
          <Link to="/bots" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" /> My Bots
          </Link>
        }
        title="Create a bot"
        description="Start with the basics — you can change everything later."
      />

      {!bots.isLoading && !canAdd ? (
        <Card>
          <EmptyState
            icon={Lock}
            title="You’ve reached your plan’s bot limit"
            description={`The ${plan.name} plan includes ${entitlements.limits.maxBotProjects} bot project${entitlements.limits.maxBotProjects === 1 ? '' : 's'}. Delete a project or upgrade to add another.`}
          >
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/bots">Manage bots</Link>
              </Button>
              <Button variant="primary" asChild>
                <Link to="/subscription">View plans</Link>
              </Button>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <form onSubmit={submit} noValidate>
              <CardHeader title="Bot details" description="Step 1 — name your project." />
              <CardBody>
                <BotDetailsFields values={values} errors={errors} onChange={setValues} groups={groups} autoFocus />
              </CardBody>
              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <Button asChild>
                  <Link to="/bots">Cancel</Link>
                </Button>
                <Button type="submit" variant="primary" disabled={create.isPending} data-testid="create-bot-submit">
                  {create.isPending ? 'Creating…' : 'Create bot'}
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader title="What happens next" description="DelyForge guides you through the rest." />
            <ul className="space-y-1 px-3 pb-3">
              {NEXT_STEPS.map((s) => (
                <li key={s.title} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <IconTile icon={s.icon} size="sm" tone="neutral" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-fg">{s.title}</div>
                    <div className="text-xs text-fg-subtle">{s.text}</div>
                  </div>
                  <Badge>Phase {s.phase}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </Page>
  );
}
