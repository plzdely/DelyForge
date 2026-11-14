import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-shimmer rounded-md bg-surface-hover', className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-border', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-surface-hover px-1 font-mono text-2xs text-fg-muted">
      {children}
    </kbd>
  );
}

/** Icon in a soft tinted square — used in cards, empty states and list items. */
export function IconTile({
  icon: Icon,
  tone = 'primary',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const tones = {
    primary: 'bg-primary-soft text-primary',
    neutral: 'bg-surface-hover text-fg-muted',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  };
  const sizes = { sm: 'size-7 [&_svg]:size-3.5', md: 'size-8 [&_svg]:size-4', lg: 'size-10 [&_svg]:size-5' };
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', tones[tone], sizes[size], className)}>
      <Icon strokeWidth={1.75} />
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <IconTile icon={icon} size="lg" tone="neutral" />
      <h4 className="mt-3 text-sm font-medium text-fg">{title}</h4>
      {description ? <p className="mt-1 max-w-72 text-xs text-fg-subtle">{description}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
