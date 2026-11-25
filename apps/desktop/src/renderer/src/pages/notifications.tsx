import type { AppNotification, NotificationType } from '@delyforge/shared';
import { Bell, BellOff, CheckCheck, MemoryStick, Plug, RotateCcw, ShieldAlert, Skull, Trash2, Unplug } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, IconTile, Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useNotificationActions, useNotifications } from '@/lib/runtime';

const ICONS: Record<NotificationType, { icon: typeof Bell; tone: 'danger' | 'warning' | 'success' | 'info' }> = {
  'bot.crashed': { icon: Skull, tone: 'danger' },
  'bot.crash_loop': { icon: Skull, tone: 'danger' },
  'bot.login_failed': { icon: Plug, tone: 'danger' },
  'bot.disconnected': { icon: Unplug, tone: 'warning' },
  'bot.high_memory': { icon: MemoryStick, tone: 'warning' },
  'bot.restarted': { icon: RotateCcw, tone: 'success' },
  'bot.permission_lost': { icon: ShieldAlert, tone: 'warning' },
};

function Row({ n, onRead }: { n: AppNotification; onRead: (id: number) => void }) {
  const meta = ICONS[n.type] ?? { icon: Bell, tone: 'info' as const };
  const unread = n.readAt === null;
  const content = (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <IconTile icon={meta.icon} tone={meta.tone} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm', unread ? 'font-semibold text-fg' : 'text-fg-muted')}>{n.title}</span>
          {unread ? <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" /> : null}
        </div>
        <p className="mt-0.5 text-xs text-fg-muted" data-selectable>
          {n.body}
        </p>
      </div>
      <span className="shrink-0 text-2xs text-fg-subtle">{timeAgo(n.createdAt)}</span>
    </div>
  );
  return (
    <li className={cn('border-b border-border last:border-0', unread && 'bg-primary-soft/40')}>
      {n.botId ? (
        <Link to={`/bots/${n.botId}`} onClick={() => unread && onRead(n.id)} className="block hover:bg-surface-hover/50">
          {content}
        </Link>
      ) : (
        <button type="button" className="block w-full text-left hover:bg-surface-hover/50" onClick={() => unread && onRead(n.id)}>
          {content}
        </button>
      )}
    </li>
  );
}

export function NotificationsPage() {
  const list = useNotifications();
  const { markRead, clear } = useNotificationActions();
  const [show, setShow] = useState<'all' | 'unread'>('all');
  const [confirm, setConfirm] = useState(false);
  const items = (list.data ?? []).filter((n) => show === 'all' || n.readAt === null);
  const unread = (list.data ?? []).filter((n) => n.readAt === null).length;

  return (
    <Page route="/notifications" ready={!list.isLoading} width="narrow">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : 'You’re all caught up.'}
        actions={
          <>
            <Button size="sm" onClick={() => markRead.mutate(undefined)} disabled={unread === 0}>
              <CheckCheck /> Mark all read
            </Button>
            <Button size="sm" onClick={() => setConfirm(true)} disabled={(list.data?.length ?? 0) === 0}>
              <Trash2 /> Clear
            </Button>
          </>
        }
      />
      <div className="mb-3 flex items-center justify-between">
        <Segmented
          ariaLabel="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` },
          ]}
        />
        <Link to="/settings" className="text-xs text-fg-subtle hover:text-fg">
          Notification preferences →
        </Link>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={show === 'unread' ? CheckCheck : BellOff}
            title={show === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description="You’ll be told here when a bot crashes, restarts, loses its connection or can’t log in."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {items.map((n) => (
              <Row key={n.id} n={n} onRead={(id) => markRead.mutate([id])} />
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear all notifications?"
        description="This removes every notification from the inbox."
        confirmLabel="Clear all"
        onConfirm={() =>
          clear.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false);
              toast.success('Notifications cleared');
            },
          })
        }
      />
    </Page>
  );
}
