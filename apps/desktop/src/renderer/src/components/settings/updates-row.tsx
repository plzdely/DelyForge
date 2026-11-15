import type { UpdateStatus } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { call } from '@/lib/bridge';

const TEXT: Record<UpdateStatus['state'], string> = {
  disabled: 'Automatic updates are on in the installed app.',
  idle: 'You have the latest version.',
  checking: 'Checking for updates…',
  downloading: 'Downloading an update…',
  ready: 'An update is ready.',
  error: 'Couldn’t check for updates. DelyForge will try again later.',
};

/** Update status for Settings → About. */
export function UpdatesRow() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['updates'], queryFn: () => call((b) => b.updates.status()), refetchInterval: 60_000 });
  const check = useMutation({ mutationFn: () => call((b) => b.updates.check()), onSuccess: (s) => qc.setQueryData(['updates'], s) });
  const s = status.data;
  if (!s) return null;
  return (
    <div className="flex items-center gap-3 border-t border-border px-5 py-3 text-sm">
      <span className="flex-1 text-fg-muted">
        {TEXT[s.state]}
        {'version' in s ? ` (${s.version})` : ''}
      </span>
      {s.state === 'ready' ? (
        <Button size="sm" variant="primary" onClick={() => void call((b) => b.updates.install())}>Restart to update</Button>
      ) : s.state !== 'disabled' ? (
        <Button size="sm" disabled={check.isPending || s.state === 'checking' || s.state === 'downloading'} onClick={() => check.mutate()}>Check now</Button>
      ) : null}
    </div>
  );
}
