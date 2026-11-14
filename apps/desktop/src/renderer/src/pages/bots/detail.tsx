import { type BotProject, isWithinLimit, updateBotProjectSchema } from '@delyforge/shared';
import { ArrowLeft, Bot, Plug, Star } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BotAvatar } from '@/components/bots/bot-avatar';
import { BotActionsMenu, BotStatus } from '@/components/bots/bot-card';
import {
  type BotDetailsErrors,
  type BotDetailsValues,
  BotDetailsFields,
  issuesToErrors,
} from '@/components/bots/bot-details-form';
import { useBotActions } from '@/components/bots/use-bot-actions';
import { Page } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, IconTile, Separator, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { timeAgo } from '@/lib/format';
import { useBot, useBots, useUpdateBot } from '@/lib/queries';

const toValues = (b: BotProject): BotDetailsValues => ({
  name: b.name,
  description: b.description,
  groupName: b.groupName ?? '',
});

function GeneralSettings({ bot, groups }: { bot: BotProject; groups: string[] }) {
  const update = useUpdateBot();
  const [values, setValues] = useState(() => toValues(bot));
  const [errors, setErrors] = useState<BotDetailsErrors>({});
  const saved = toValues(bot);
  const dirty =
    values.name.trim() !== saved.name ||
    values.description.trim() !== saved.description ||
    values.groupName.trim() !== saved.groupName;

  // Pick up changes made elsewhere (e.g. favorite toggled) without losing unsaved edits.
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
      onError: (err) => toast.error('Could not save', { description: (err as Error).message }),
    });
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader title="General" description="How this project appears in DelyForge." />
        <CardBody>
          <BotDetailsFields values={values} errors={errors} onChange={setValues} groups={groups} />
        </CardBody>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {dirty ? <span className="mr-auto text-xs text-fg-subtle">Unsaved changes</span> : null}
          <Button
            disabled={!dirty || update.isPending}
            onClick={() => {
              setValues(saved);
              setErrors({});
            }}
          >
            Discard
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function BotDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const bot = useBot(id);
  const bots = useBots();
  const entitlements = useEntitlements();
  const { actions, confirmDialog } = useBotActions({ afterDelete: () => navigate('/bots') });
  const route = `/bots/${id}`;

  const groups = useMemo(
    () => [...new Set((bots.data ?? []).map((b) => b.groupName).filter((g): g is string => g !== null))],
    [bots.data],
  );
  const canAdd = isWithinLimit(entitlements, 'maxBotProjects', (bots.data?.length ?? 0) + 1);

  if (bot.isLoading) {
    return (
      <Page route={route} ready={false}>
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-6 h-80" />
      </Page>
    );
  }

  if (bot.isError || !bot.data) {
    return (
      <Page route={route}>
        <Card>
          <EmptyState icon={Bot} title="Bot not found" description="It may have been deleted.">
            <Button asChild>
              <Link to="/bots">
                <ArrowLeft /> Back to My Bots
              </Link>
            </Button>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const b = bot.data;
  return (
    <Page route={route}>
      <Link to="/bots" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-fg-subtle hover:text-fg">
        <ArrowLeft className="size-3.5" /> My Bots
      </Link>

      <div className="mb-6 flex items-center gap-4">
        <BotAvatar id={b.id} name={b.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-fg">{b.name}</h1>
            {b.groupName ? <Badge>{b.groupName}</Badge> : null}
          </div>
          <div className="mt-1">
            <BotStatus bot={b} />
          </div>
        </div>
        <Button
          aria-pressed={b.isFavorite}
          onClick={() => actions.toggleFavorite(b)}
        >
          <Star className={cn(b.isFavorite && 'fill-warning text-warning')} />
          {b.isFavorite ? 'Favorited' : 'Favorite'}
        </Button>
        <BotActionsMenu bot={b} actions={actions} canAdd={canAdd} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          {/* key → reset the form when switching between bots */}
          <GeneralSettings key={b.id} bot={b} groups={groups} />
        </div>
        <div className="space-y-3">
          <Card>
            <CardHeader title="Discord connection" />
            <CardBody>
              <div className="flex items-start gap-3">
                <IconTile icon={Plug} tone="neutral" />
                <div>
                  <p className="text-sm text-fg">Not connected yet</p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    The guided Discord setup — token, intents, permissions and invite link — arrives in Phase 3.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Project" />
            <Separator />
            <dl className="space-y-2.5 px-5 py-4 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-subtle">Created</dt>
                <dd className="text-fg-muted" title={b.createdAt}>
                  {timeAgo(b.createdAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-subtle">Last updated</dt>
                <dd className="text-fg-muted" title={b.updatedAt}>
                  {timeAgo(b.updatedAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-fg-subtle">Project ID</dt>
                <dd className="truncate font-mono text-2xs leading-4 text-fg-muted" data-selectable title={b.id}>
                  {b.id}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
      {confirmDialog}
    </Page>
  );
}
