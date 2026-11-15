import { hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { call } from '@/lib/bridge';
import { useEntitlements } from '@/lib/entitlements';
import { builderKeys } from '@/lib/builders';
import { moduleKeys } from '@/lib/modules';
import { queryKeys } from '@/lib/queries';

/** Daily automatic backups (Pro): list, back up now, restore one bot. */
export function BackupsCard() {
  const qc = useQueryClient();
  const allowed = hasFeature(useEntitlements(), 'backups');
  const list = useQuery({ queryKey: ['backups'], queryFn: () => call((b) => b.backups.list()), enabled: allowed });
  const [pending, setPending] = useState<{ file: string; id: string; name: string; date: string } | null>(null);
  const run = useMutation({
    mutationFn: () => call((b) => b.backups.run()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['backups'] });
      toast.success('Backup saved');
    },
    onError: (e: Error) => toast.error('Backup failed', { description: e.message }),
  });
  const restore = useMutation({
    mutationFn: (p: { file: string; id: string }) => call((b) => b.backups.restore(p)),
    onSuccess: (_d, p) => {
      for (const key of [moduleKeys.modules(p.id), builderKeys.builders(p.id), queryKeys.bots]) void qc.invalidateQueries({ queryKey: key });
      toast.success('Settings restored');
    },
    onError: (e: Error) => toast.error('Couldn’t restore', { description: e.message }),
  });

  return (
    <Card>
      <CardHeader
        title="Backups"
        description="Every day DelyForge saves a copy of each bot’s settings on this computer (bot tokens are never included). The last 14 days are kept."
        action={allowed ? <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>Back up now</Button> : null}
      />
      <CardBody>
        {!allowed ? (
          <p className="text-sm text-fg-muted">
            Automatic backups are included in {lowestPlanWithFeature('backups')?.name ?? 'Pro'}. <Link to="/subscription" className="text-primary hover:underline">View plans</Link>
          </p>
        ) : !list.data?.length ? (
          <p className="text-sm text-fg-subtle">No backups yet — the first one is made a minute after DelyForge starts.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {list.data.map((b) => (
              <li key={b.file} className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-fg tabular-nums">{new Date(b.createdAt).toLocaleDateString()}</span>
                {b.bots.map((bot) => (
                  <Button key={bot.id} size="sm" variant="ghost" onClick={() => setPending({ file: b.file, id: bot.id, name: bot.name, date: new Date(b.createdAt).toLocaleDateString() })}>
                    Restore “{bot.name}”
                  </Button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Restore “${pending?.name ?? ''}”?`}
        description={`Its modules, commands, embeds, workflows and presence go back to how they were on ${pending?.date ?? ''}. Changes made since then are replaced. The Discord connection is kept.`}
        confirmLabel="Restore"
        onConfirm={() => pending && restore.mutate({ file: pending.file, id: pending.id })}
      />
    </Card>
  );
}
