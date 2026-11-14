import type { BotProject } from '@delyforge/shared';
import { Copy, Download, ExternalLink, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { cn } from '@/lib/cn';
import { BotIdentityAvatar } from './bot-avatar';
import { BotControls, BotStatusLine } from './runtime-ui';
import type { useBotActions } from './use-bot-actions';

type Actions = ReturnType<typeof useBotActions>['actions'];

export function BotActionsMenu({ bot, actions, canAdd }: { bot: BotProject; actions: Actions; canAdd: boolean }) {
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${bot.name}`} className="size-7">
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={ExternalLink} onSelect={() => navigate(`/bots/${bot.id}`)}>
          Open
        </MenuItem>
        <MenuItem icon={Star} onSelect={() => actions.toggleFavorite(bot)}>
          {bot.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        </MenuItem>
        <MenuItem icon={Copy} disabled={!canAdd} onSelect={() => actions.duplicate(bot)}>
          Duplicate{!canAdd ? ' — plan limit reached' : ''}
        </MenuItem>
        <MenuItem icon={Download} onSelect={() => actions.exportToFile(bot)}>
          Export…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onSelect={() => actions.requestDelete(bot)}>
          Delete…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Live status line (kept as BotStatus for existing callers). */
export function BotStatus({ bot }: { bot: BotProject }) {
  return <BotStatusLine bot={bot} />;
}

export function BotCard({ bot, actions, canAdd }: { bot: BotProject; actions: Actions; canAdd: boolean }) {
  return (
    <div className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 shadow-card transition-[border-color,transform] duration-150 hover:border-border-strong">
      {/* Whole card is a link; the buttons sit above it. */}
      <Link to={`/bots/${bot.id}`} className="absolute inset-0 rounded-xl" aria-label={`Open ${bot.name}`} />
      <div className="flex items-start gap-3">
        <BotIdentityAvatar bot={bot} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg">{bot.name}</div>
          <div className="mt-0.5">
            <BotStatus bot={bot} />
          </div>
        </div>
        <div className="relative z-10 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-7', !bot.isFavorite && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
            aria-label={bot.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={bot.isFavorite}
            onClick={() => actions.toggleFavorite(bot)}
          >
            <Star className={cn(bot.isFavorite && 'fill-warning text-warning')} />
          </Button>
          <BotActionsMenu bot={bot} actions={actions} canAdd={canAdd} />
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-fg-muted">
        {bot.description || <span className="text-fg-subtle italic">No description</span>}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        {bot.groupName ? <Badge>{bot.groupName}</Badge> : <span className="text-2xs text-fg-subtle">No group</span>}
        <div className="relative z-10">
          <BotControls bot={bot} size="sm" />
        </div>
      </div>
    </div>
  );
}
