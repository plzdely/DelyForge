import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-md border border-border-strong bg-bg-subtle px-3 text-sm text-fg placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 outline-none hover:border-fg-subtle/40 focus:border-primary focus:shadow-[0_0_0_3px_var(--df-primary-soft)] disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_3px_var(--df-danger-soft)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, 'min-h-20 resize-none py-2 leading-5', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

/** Label + control + hint/error, with the right ARIA wiring. Pass the control's id as `htmlFor`. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  counter,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  counter?: { value: number; max: number };
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-xs font-medium text-fg">
          {label}
          {optional ? <span className="ml-1 font-normal text-fg-subtle">(optional)</span> : null}
        </label>
        {counter ? (
          <span className={cn('text-2xs tabular-nums', counter.value > counter.max ? 'text-danger' : 'text-fg-subtle')}>
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
