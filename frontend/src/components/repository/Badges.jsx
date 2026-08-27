import { CheckCircle2, CircleDashed, GitFork, Loader2, Lock, ShieldAlert, Unlock, XCircle, Clock } from 'lucide-react';
import { Badge } from '../ui/primitives.jsx';
import { Tooltip } from '../ui/overlays.jsx';

const INDEX_STATES = {
  indexed: { label: 'Indexed', variant: 'success', icon: CheckCircle2, tip: 'Fully indexed and ready for AI features' },
  partial: { label: 'Partial index', variant: 'warning', icon: CheckCircle2, tip: 'Large repository — the most relevant source files were indexed' },
  indexing: { label: 'Indexing', variant: 'primary', icon: Loader2, tip: 'Indexing is running right now' },
  queued: { label: 'Queued', variant: 'primary', icon: Clock, tip: 'Waiting for a worker to pick the job up' },
  failed: { label: 'Index failed', variant: 'danger', icon: XCircle, tip: 'The last indexing attempt failed' },
  not_indexed: { label: 'Not indexed', variant: 'muted', icon: CircleDashed, tip: 'Index this repository to unlock AI features' },
};

export function IndexBadge({ status, className }) {
  const state = INDEX_STATES[status] || INDEX_STATES.not_indexed;
  const Icon = state.icon;
  return (
    <Tooltip content={state.tip}>
      <Badge variant={state.variant} className={className}>
        <Icon className={status === 'indexing' ? 'animate-spin' : undefined} aria-hidden="true" />
        {state.label}
      </Badge>
    </Tooltip>
  );
}

export function AccessBadge({ access, className }) {
  if (!access) return null;
  const canWrite = access.canWrite;
  return (
    <Tooltip content={canWrite ? 'GitHub reports push access for your account' : 'GitHub reports read-only access — use the fork workflow to propose changes'}>
      <Badge variant={canWrite ? 'primary' : 'outline'} className={className}>
        {canWrite ? <Unlock aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
        {canWrite ? `Read & write · ${access.role}` : 'Read only'}
      </Badge>
    </Tooltip>
  );
}

export function VisibilityBadge({ visibility, isFork, className }) {
  return (
    <span className={className}>
      <Badge variant="outline">
        {visibility === 'private' ? <Lock aria-hidden="true" /> : null}
        {visibility === 'private' ? 'Private' : 'Public'}
      </Badge>
      {isFork ? (
        <Badge variant="muted" className="ml-1.5">
          <GitFork aria-hidden="true" />
          Fork
        </Badge>
      ) : null}
    </span>
  );
}

export function StaleBadge({ freshness }) {
  if (!freshness?.stale) return null;
  return (
    <Tooltip content="The indexed commit is behind the branch head — re-index for accurate answers">
      <Badge variant="warning">
        <Clock aria-hidden="true" />
        Index out of date
      </Badge>
    </Tooltip>
  );
}
