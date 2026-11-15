import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { accountKeys, useAccount, useInvalidateAccount } from '@/lib/account';
import { call } from '@/lib/bridge';

/** Shows the linked Discord account, or a button that opens Discord's sign-in page in the browser. */
export function DiscordConnect({ required = false }: { required?: boolean }) {
  const account = useAccount();
  const qc = useQueryClient();
  const invalidate = useInvalidateAccount();
  const discord = account.data?.profile?.discord ?? null;
  const link = useMutation({
    mutationFn: () => call((b) => b.account.linkDiscord()),
    onSuccess: (status) => {
      qc.setQueryData(accountKeys.status, status);
      invalidate();
      toast.success('Discord connected');
    },
    onError: (e: Error) => toast.error('Discord not connected', { description: e.message }),
  });

  return (
    <Card>
      <CardHeader
        title="Discord account"
        description={required ? 'DelyForge needs your Discord account before you can use it. We only see your Discord name and picture.' : 'Your DelyForge account is linked to this Discord account.'}
      />
      <CardBody>
        {discord ? (
          <div className="flex items-center gap-3 text-sm">
            {discord.avatarUrl ? <img src={discord.avatarUrl} alt="" className="size-8 rounded-full" /> : null}
            <span className="font-medium text-fg">{discord.username}</span>
            <CircleCheck className="size-4 text-success" aria-label="Linked" />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={link.isPending} onClick={() => link.mutate()}>
              {link.isPending ? 'Waiting for Discord…' : 'Connect Discord'}
            </Button>
            {link.isPending ? <span className="text-xs text-fg-muted">Click Authorize in your browser, then come back.</span> : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
