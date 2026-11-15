import type { BotProject } from '@delyforge/shared';
import { Copy, Download, ExternalLink, MoreHorizontal, Plus, Server, SquareSlash, Star, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { cn } from '@/lib/cn';
import { BotIdentityAvatar, botBanner } from './bot-avatar';
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
    <div className="card-interactive group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      {/* Whole card is a link; the buttons sit above it. */}
      <Link to={`/bots/${bot.id}`} className="absolute inset-0 z-[1] rounded-xl" aria-label={`Open ${bot.name}`} />
      <div className="relative h-16" style={{ background: botBanner(bot.id) }}>
        <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg bg-bg/40 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-7', !bot.isFavorite && 'hidden group-focus-within:inline-flex group-hover:inline-flex')}
            aria-label={bot.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={bot.isFavorite}
            onClick={() => actions.toggleFavorite(bot)}
          >
            <Star className={cn(bot.isFavorite && 'fill-warning text-warning')} />
          </Button>
          <BotActionsMenu bot={bot} actions={actions} canAdd={canAdd} />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <BotIdentityAvatar bot={bot} size="lg" className="relative z-[2] -mt-7 self-start rounded-xl ring-4 ring-surface" />
        <div className="mt-2 flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">{bot.name}</span>
          {bot.groupName ? <Badge>{bot.groupName}</Badge> : null}
        </div>
        <div className="mt-0.5">
          <BotStatus bot={bot} />
        </div>
        <p className="mt-2.5 line-clamp-2 min-h-10 text-xs leading-5 text-fg-muted">
          {bot.description || <span className="text-fg-subtle italic">No description</span>}
        </p>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-3 text-xs text-fg-muted tabular-nums">
            <span className="inline-flex items-center gap-1" title="Servers">
              <Server className="size-3.5 text-fg-subtle" aria-hidden="true" /> {bot.guildCount}
            </span>
            <span className="inline-flex items-center gap-1" title="Commands used">
              <SquareSlash className="size-3.5 text-fg-subtle" aria-hidden="true" /> {bot.commandsExecuted.toLocaleString()}
            </span>
          </div>
          <div className="relative z-10">
            <BotControls bot={bot} size="sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The last tile in the grid: start another bot. */
export function NewBotCard() {
  return (
    <Link
      to="/bots/new"
      className="card-interactive flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-fg-muted hover:text-fg"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Plus className="size-5" />
      </span>
      <span className="text-sm font-medium">Create a bot</span>
      <span className="text-xs text-fg-subtle">Start from scratch or a template</span>
    </Link>
  );
}
