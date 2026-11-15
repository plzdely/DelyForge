import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Trash2, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { GuildPicker } from '@/components/modules/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/misc';
import { call } from '@/lib/bridge';
import { timeAgo } from '@/lib/format';
import { ModuleWorkspaceGate, useModuleWorkspace } from './modules';

const who = (name: string | null, id: string) => name ?? `Member ${id.slice(-4)}`;

/** Warnings and levels for the selected server, with the actions staff would otherwise do with slash commands. */
export function BotMembers() {
  const ws = useModuleWorkspace();
  const qc = useQueryClient();
  const guildId = ws.guild?.id ?? '';
  const route = `/bots/${ws.bot.id}/members`;
  const key = ['members', ws.bot.id, guildId];
  const data = useQuery({ queryKey: key, queryFn: () => call((b) => b.members.data({ id: ws.bot.id, guildId })), enabled: Boolean(guildId) });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const fail = (title: string) => (e: Error) => toast.error(title, { description: e.message });
  const [confirm, setConfirm] = useState<{ title: string; description: string; label: string; run: () => void } | null>(null);

  const delWarning = useMutation({ mutationFn: (warningId: number) => call((b) => b.members.deleteWarning({ id: ws.bot.id, guildId, warningId })), onSuccess: refresh, onError: fail('Couldn’t remove the warning') });
  const clearWarnings = useMutation({
    mutationFn: (userId: string) => call((b) => b.members.clearWarnings({ id: ws.bot.id, guildId, userId })),
    onSuccess: (n) => (refresh(), toast.success(`Removed ${n} warning${n === 1 ? '' : 's'}`)),
    onError: fail('Couldn’t clear warnings'),
  });
  const resetXp = useMutation({
    mutationFn: (userId: string | null) => call((b) => b.members.resetXp({ id: ws.bot.id, guildId, userId })),
    onSuccess: (n) => (refresh(), toast.success(`Reset ${n} member${n === 1 ? '' : 's'}`)),
    onError: fail('Couldn’t reset XP'),
  });

  const warnings = data.data?.warnings ?? [];
  const levels = data.data?.levels ?? [];
  const warnCount = new Map<string, number>();
  for (const w of warnings) warnCount.set(w.userId, (warnCount.get(w.userId) ?? 0) + 1);

  return (
    <ModuleWorkspaceGate ws={ws} route={route}>
      <div data-route-ready={data.data ? route : undefined} className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-fg-muted">Warnings and levels for the selected server. Changes apply right away, even while the bot is running.</p>
          {ws.guild ? (
            <GuildPicker guilds={ws.guilds.data ?? []} value={ws.guild.id} onChange={ws.selectGuild} onRefresh={() => ws.refresh.mutate()} refreshing={ws.refresh.isPending} />
          ) : null}
        </div>
        {data.error ? <Card className="p-4 text-sm text-danger">{data.error.message}</Card> : null}

        <Card>
          <CardHeader title="Warnings" description="From /warn and auto-moderation. Removing a warning lowers the member’s count for warning thresholds." />
          <CardBody>
            {!warnings.length ? (
              <EmptyState icon={ShieldAlert} title="No warnings" description="Nobody in this server has been warned." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-fg-muted">
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 font-medium">Reason</th>
                    <th className="pb-2 font-medium">By</th>
                    <th className="pb-2 font-medium">When</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {warnings.map((w) => (
                    <tr key={w.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3 font-medium text-fg">
                        {who(w.userName, w.userId)}
                        <div className="text-2xs font-normal text-fg-subtle">{warnCount.get(w.userId)} total</div>
                      </td>
                      <td className="py-2 pr-3 text-fg-muted" data-selectable>{w.reason}</td>
                      <td className="py-2 pr-3 text-fg-muted">{w.moderatorName ?? 'Auto-moderation / staff'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-fg-subtle">{timeAgo(w.createdAt)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" aria-label={`Remove this warning for ${who(w.userName, w.userId)}`} onClick={() => delWarning.mutate(w.id)}>
                          <Trash2 />
                        </Button>
                        {(warnCount.get(w.userId) ?? 0) > 1 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setConfirm({
                                title: `Clear all warnings for ${who(w.userName, w.userId)}?`,
                                description: `All ${warnCount.get(w.userId)} of their warnings in this server are removed. This can’t be undone.`,
                                label: 'Clear warnings',
                                run: () => clearWarnings.mutate(w.userId),
                              })
                            }
                          >
                            Clear all
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Levels"
            description="The top 100 by XP. Members who haven’t chatted since this was added show a short ID instead of a name."
            action={
              levels.length ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setConfirm({
                      title: 'Reset everyone’s XP in this server?',
                      description: 'Every member goes back to level 0. Roles already given as rewards stay. This can’t be undone.',
                      label: 'Reset everyone',
                      run: () => resetXp.mutate(null),
                    })
                  }
                >
                  Reset everyone
                </Button>
              ) : null
            }
          />
          <CardBody>
            {!levels.length ? (
              <EmptyState icon={TrendingUp} title="No XP yet" description="Turn on the Leveling module and members earn XP by chatting." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-fg-muted">
                    <th className="pb-2 font-medium">#</th>
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 text-right font-medium">Level</th>
                    <th className="pb-2 text-right font-medium">XP</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {levels.map((l, i) => (
                    <tr key={l.userId} className="border-t border-border">
                      <td className="py-2 pr-3 text-fg-subtle tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-3 font-medium text-fg">{who(l.name, l.userId)}</td>
                      <td className="py-2 pr-3 text-right text-fg tabular-nums">{l.level}</td>
                      <td className="py-2 pr-3 text-right text-fg-muted tabular-nums">{l.xp.toLocaleString()}</td>
                      <td className="py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setConfirm({
                              title: `Reset XP for ${who(l.name, l.userId)}?`,
                              description: 'They go back to level 0. Roles already given as rewards stay.',
                              label: 'Reset XP',
                              run: () => resetXp.mutate(l.userId),
                            })
                          }
                        >
                          Reset
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.label ?? 'Confirm'}
        onConfirm={() => confirm?.run()}
      />
    </ModuleWorkspaceGate>
  );
}
