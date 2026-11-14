import { ChevronDown } from 'lucide-react';
import { type SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

/** Native select styled to match inputs (native = reliable keyboard and screen-reader behaviour). */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className="h-9 w-full appearance-none rounded-md border border-border-strong bg-bg-subtle pr-8 pl-3 text-sm text-fg outline-none transition-[border-color,box-shadow] hover:border-fg-subtle/40 focus:border-primary focus:shadow-[0_0_0_3px_var(--df-primary-soft)] disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  ),
);
Select.displayName = 'Select';
