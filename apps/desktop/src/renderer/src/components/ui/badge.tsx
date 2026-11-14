import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-px text-2xs font-medium tracking-wide whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border-strong bg-surface-hover text-fg-muted',
        primary: 'border-primary-border bg-primary-soft text-primary',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
        info: 'border-transparent bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Small coloured dot used for online / offline / error status. */
export function StatusDot({ status }: { status: 'online' | 'offline' | 'starting' | 'error' }) {
  const color = {
    online: 'bg-success shadow-[0_0_0_3px_var(--df-success-soft)]',
    starting: 'bg-warning shadow-[0_0_0_3px_var(--df-warning-soft)] animate-shimmer',
    error: 'bg-danger shadow-[0_0_0_3px_var(--df-danger-soft)]',
    offline: 'bg-fg-subtle/60',
  }[status];
  return <span aria-label={status} className={cn('inline-block size-1.5 rounded-full', color)} />;
}
