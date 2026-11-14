import { useId } from 'react';
import { cn } from '@/lib/cn';

/** DelyForge mark: a forged "D" around a prompt chevron — build, automate, control. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6', className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a7cff" />
          <stop offset="1" stopColor="#5a56f0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill={`url(#${id}-g)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="none" stroke="white" strokeOpacity="0.18" />
      <path
        d="M9.5 8.5h6.25a7.5 7.5 0 0 1 0 15H9.5z"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M13.4 13.2l2.6 2.8-2.6 2.8"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-5" />
      <span className="text-sm font-semibold tracking-[-0.02em] text-fg">DelyForge</span>
    </span>
  );
}
