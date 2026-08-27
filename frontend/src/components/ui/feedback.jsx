import { AlertTriangle, Info, RefreshCw, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './button.jsx';
import { Skeleton } from './primitives.jsx';

const ALERT_STYLES = {
  info: { wrapper: 'border-border bg-secondary/40 text-foreground', icon: Info, iconClass: 'text-muted-foreground' },
  warning: { wrapper: 'border-warning/30 bg-warning/10 text-foreground', icon: AlertTriangle, iconClass: 'text-warning' },
  danger: { wrapper: 'border-destructive/30 bg-destructive/10 text-foreground', icon: ShieldAlert, iconClass: 'text-destructive' },
  success: { wrapper: 'border-success/30 bg-success/10 text-foreground', icon: CheckCircle2, iconClass: 'text-success' },
};

export function Alert({ variant = 'info', title, children, actions, className, icon }) {
  const style = ALERT_STYLES[variant] || ALERT_STYLES.info;
  const Icon = icon || style.icon;
  return (
    <div role={variant === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-md border p-3', style.wrapper, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="text-xs font-semibold">{title}</p> : null}
        {children ? <div className="text-xs leading-relaxed text-muted-foreground">{children}</div> : null}
        {actions ? <div className="flex flex-wrap gap-2 pt-1.5">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className, compact = false }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/40 text-center',
        compact ? 'gap-2 p-6' : 'gap-3 p-10',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-9 items-center justify-center rounded-md border border-border bg-card">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, title = 'Something went wrong' }) {
  const message = error?.message || 'Unexpected error.';
  const code = error?.code;
  return (
    <Alert
      variant="danger"
      title={title}
      className={className}
      actions={
        onRetry ? (
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
        ) : null
      }
    >
      <span>{message}</span>
      {code ? <span className="ml-1 font-mono text-2xs opacity-60">({code})</span> : null}
    </Alert>
  );
}

export function LoadingRows({ rows = 3, className }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function LoadingLines({ lines = 4, className }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn('h-3', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function StatTile({ label, value, hint, icon: Icon, tone = 'default' }) {
  const tones = {
    default: 'text-foreground',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  };
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
        {label}
      </div>
      <p className={cn('mt-1 font-mono text-lg font-semibold leading-none', tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
