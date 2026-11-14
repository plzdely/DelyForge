import type { BotProject } from '@delyforge/shared';
import { cn } from '@/lib/cn';

// Hues chosen to sit within the brand (violet → indigo → blue) with a few accents for variety.
const HUES = [262, 250, 238, 226, 280, 295, 205, 168];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Placeholder avatar until the bot's Discord avatar is connected (Phase 3). Stable colour per project. */
export function BotAvatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const hue = HUES[hash(id) % HUES.length] ?? 262;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0]?.toUpperCase() ?? '')
      .join('') || '?';
  const sizes = { sm: 'size-7 text-2xs rounded-md', md: 'size-9 text-xs rounded-lg', lg: 'size-12 text-base rounded-xl' };
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold text-white', sizes[size])}
      style={{
        background: `linear-gradient(135deg, oklch(0.62 0.17 ${hue}), oklch(0.5 0.19 ${hue + 18}))`,
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.14)',
      }}
    >
      {initials}
    </span>
  );
}

/** Shows the bot's Discord avatar once connected, otherwise the generated placeholder. */
export function BotIdentityAvatar({ bot, size = 'md' }: { bot: BotProject; size?: 'sm' | 'md' | 'lg' }) {
  if (bot.botAvatarUrl) {
    const px = { sm: 'size-7 rounded-md', md: 'size-9 rounded-lg', lg: 'size-12 rounded-xl' }[size];
    return <img src={bot.botAvatarUrl} alt="" className={cn('shrink-0 object-cover', px)} />;
  }
  return <BotAvatar id={bot.id} name={bot.name} size={size} />;
}
