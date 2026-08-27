import { forwardRef } from 'react';
import { cn } from '../../lib/utils.js';

export const Card = forwardRef(function Card({ className, interactive = false, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-subtle',
        interactive && 'transition-colors hover:border-primary/40 hover:bg-card/80',
        className,
      )}
      {...props}
    />
  );
});

export const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />;
});

export const CardTitle = forwardRef(function CardTitle({ className, as: Component = 'h3', ...props }, ref) {
  return <Component ref={ref} className={cn('text-sm font-semibold leading-none tracking-tight', className)} {...props} />;
});

export const CardDescription = forwardRef(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />;
});

export const CardContent = forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />;
});

export const CardFooter = forwardRef(function CardFooter({ className, ...props }, ref) {
  return <div ref={ref} className={cn('flex items-center gap-2 border-t border-border p-3', className)} {...props} />;
});

/** Section header used across pages: title, optional description, right-side actions. */
export function SectionHeader({ title, description, actions, className, icon: Icon }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
