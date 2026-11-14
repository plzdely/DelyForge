import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Standard page frame. `route` + `ready` set a `data-route-ready` marker once the page's data has loaded,
 * which the automated desktop smoke test waits for.
 */
export function Page({
  route,
  ready = true,
  children,
  className,
  width = 'default',
}: {
  route: string;
  ready?: boolean;
  children: ReactNode;
  className?: string;
  width?: 'default' | 'narrow';
}) {
  return (
    <div
      data-route-ready={ready ? route : undefined}
      className={cn('mx-auto w-full px-8 pt-7 pb-12', width === 'narrow' ? 'max-w-3xl' : 'max-w-6xl', className)}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5 text-xs font-medium text-fg-subtle">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
