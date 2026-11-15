import { useMutation } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useAccount, useInvalidateAccount } from '@/lib/account';
import { call } from '@/lib/bridge';

/** Shows the linked Discord account, or a button that opens Discord's sign-in page in the browser. */
export function DiscordConnect({ required = false }: { required?: boolean }) {
  const account = useAccount();
  const invalidate = useInvalidateAccount();
  const discord = account.data?.profile?.discord ?? null;
  const [waiting, setWaiting] = useState(false);
  const link = useMutation({
    mutationFn: () => call((b) => b.account.linkDiscord()),
    onSuccess: () => {
      setWaiting(true);
      toast('Finish in your browser', { description: 'Approve DelyForge on Discord, then come back here.' });
    },
    onError: (e: Error) => toast.error('Couldn’t open Discord', { description: e.message }),
  });

  // When the person comes back from the browser, ask the server whether the link went through.
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => void call((b) => b.account.refresh()).then(invalidate).catch(() => null);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

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
              Connect Discord
            </Button>
            {waiting ? (
              <Button variant="ghost" onClick={() => void call((b) => b.account.refresh()).then(invalidate)}>
                I’ve approved it
              </Button>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
