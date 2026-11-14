import type { BotProject } from '@delyforge/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useDeleteBot, useDuplicateBot, useExportBot, useImportBot, useUpdateBot } from '@/lib/queries';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Shared bot-project actions (used by the list, the cards and the detail page) with consistent toasts and a delete
 * confirmation. Render `confirmDialog` once in the component that uses the hook.
 */
export function useBotActions(opts: { afterDelete?: () => void } = {}) {
  const navigate = useNavigate();
  const duplicate = useDuplicateBot();
  const remove = useDeleteBot();
  const exportBot = useExportBot();
  const importBot = useImportBot();
  const update = useUpdateBot();
  const [pendingDelete, setPendingDelete] = useState<BotProject | null>(null);

  const actions = {
    duplicate: (bot: BotProject) =>
      duplicate.mutate(bot.id, {
        onSuccess: (copy) =>
          toast.success(`Created “${copy.name}”`, {
            action: { label: 'Open', onClick: () => navigate(`/bots/${copy.id}`) },
          }),
        onError: (e) => toast.error('Could not duplicate', { description: errorMessage(e) }),
      }),

    exportToFile: (bot: BotProject) =>
      exportBot.mutate(bot.id, {
        onSuccess: (r) => {
          if (r.saved) toast.success('Project exported', { description: `${r.fileName} — your bot token is never included.` });
        },
        onError: (e) => toast.error('Export failed', { description: errorMessage(e) }),
      }),

    importFromFile: () =>
      importBot.mutate(undefined, {
        onSuccess: (r) => {
          if (!r.project) return; // cancelled
          const project = r.project;
          toast.success(`Imported “${project.name}”`, {
            action: { label: 'Open', onClick: () => navigate(`/bots/${project.id}`) },
          });
        },
        onError: (e) => toast.error('Import failed', { description: errorMessage(e) }),
      }),

    toggleFavorite: (bot: BotProject) =>
      update.mutate(
        { id: bot.id, patch: { isFavorite: !bot.isFavorite } },
        { onError: (e) => toast.error('Could not update', { description: errorMessage(e) }) },
      ),

    requestDelete: (bot: BotProject) => setPendingDelete(bot),
  };

  const confirmDialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      onOpenChange={(open) => !open && setPendingDelete(null)}
      title={`Delete “${pendingDelete?.name ?? ''}”?`}
      description="This permanently removes the project, its configuration and its stored bot token from this computer. Your bot’s application on Discord is not affected. Export the project first if you may want it back."
      confirmLabel="Delete project"
      busy={remove.isPending}
      onConfirm={() => {
        const bot = pendingDelete;
        if (!bot) return;
        remove.mutate(bot.id, {
          onSuccess: () => {
            setPendingDelete(null);
            toast.success(`Deleted “${bot.name}”`);
            opts.afterDelete?.();
          },
          onError: (e) => toast.error('Could not delete', { description: errorMessage(e) }),
        });
      }}
    />
  );

  return { actions, confirmDialog, importing: importBot.isPending };
}
