import { useBlocker } from 'react-router';
import { ConfirmDialog } from '@/components/ui/dialog';

/** Asks before leaving a screen with unsaved changes. Render the returned element anywhere on the screen. */
export function useUnsavedChangesGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
      title="Leave without saving?"
      description="You have changes on this screen that aren’t saved yet. If you leave now, they’re lost."
      confirmLabel="Leave without saving"
      onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
    />
  );
}
