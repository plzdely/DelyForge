import type { BotProject } from '@delyforge/shared';
import { cn } from '@/lib/cn';

// Hues chosen to sit within the brand (violet → indigo → blue) with a few accents for variety.
const HUES = [262, 250, 238, 226, 280, 295, 205, 168];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Each bot's own colour (stable per project), used by its avatar and banner. */
export const botHue = (id: string): number => HUES[hash(id) % HUES.length] ?? 262;

/** A soft banner in the bot's colour, fading into the card. */
export const botBanner = (id: string): string => {
  const hue = botHue(id);
  return `radial-gradient(120% 140% at 0% 0%, oklch(0.55 0.2 ${hue} / 0.55), transparent 70%), linear-gradient(135deg, oklch(0.42 0.16 ${hue} / 0.55), oklch(0.32 0.14 ${hue + 30} / 0.35))`;
};

/** Placeholder avatar until the bot's Discord avatar is connected. Stable colour per project. */
export function BotAvatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const hue = botHue(id);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0]?.toUpperCase() ?? '')
      .join('') || '?';
  const sizes = { sm: 'size-7 text-2xs rounded-md', md: 'size-9 text-xs rounded-lg', lg: 'size-12 text-base rounded-xl', xl: 'size-16 text-xl rounded-2xl' };
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
export function BotIdentityAvatar({ bot, size = 'md', className }: { bot: BotProject; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  if (bot.botAvatarUrl) {
    const px = { sm: 'size-7 rounded-md', md: 'size-9 rounded-lg', lg: 'size-12 rounded-xl', xl: 'size-16 rounded-2xl' }[size];
    return <img src={bot.botAvatarUrl} alt="" className={cn('shrink-0 object-cover', px, className)} />;
  }
  return (
    <span className={cn('inline-flex shrink-0', className)}>
      <BotAvatar id={bot.id} name={bot.name} size={size} />
    </span>
  );
}
