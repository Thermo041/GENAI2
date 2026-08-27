import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ExternalLink, GitPullRequest, Loader2, ShieldAlert, XCircle, GitCompare, Database } from 'lucide-react';
import { Badge } from '../ui/primitives.jsx';
import { EmptyState } from '../ui/feedback.jsx';
import { timeAgo } from '../../lib/utils.js';

const CHANGE_STATUS = {
  proposed: { label: 'Awaiting review', variant: 'primary', icon: Clock },
  applying: { label: 'Applying', variant: 'primary', icon: Loader2 },
  committed: { label: 'Committed', variant: 'success', icon: CheckCircle2 },
  pr_open: { label: 'PR open', variant: 'success', icon: GitPullRequest },
  rejected: { label: 'Rejected', variant: 'muted', icon: XCircle },
  failed: { label: 'Failed', variant: 'danger', icon: ShieldAlert },
};

const RISK = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'success' };

/** Shared feed renderer for changes, reviews and index jobs. */
export function ActivityFeed({ items = [], kind = 'changes', emptyTitle, emptyDescription }) {
  if (!items.length) {
    const defaults = {
      changes: ['No AI changes yet', 'Ask the assistant for a change and it will show up here once proposed.'],
      reviews: ['No AI reviews yet', 'Open a pull request page and run a review, or let the webhook do it automatically.'],
      jobs: ['No indexing jobs yet', 'Index a repository to see job history.'],
    };
    const [title, description] = defaults[kind] || ['Nothing here yet', ''];
    return <EmptyState compact icon={kind === 'reviews' ? GitPullRequest : kind === 'jobs' ? Database : GitCompare} title={emptyTitle || title} description={emptyDescription || description} />;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {items.map((item) => (
        <li key={item.id} className="p-3">
          {kind === 'changes' ? <ChangeRow item={item} /> : kind === 'reviews' ? <ReviewRow item={item} /> : <JobRow item={item} />}
        </li>
      ))}
    </ul>
  );
}

function ChangeRow({ item }) {
  const status = CHANGE_STATUS[item.status] || CHANGE_STATUS.proposed;
  const StatusIcon = status.icon;
  const [owner, repo] = item.repository.split('/');
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{item.summary || 'AI change'}</p>
        <Badge variant={status.variant} className="shrink-0">
          <StatusIcon className={item.status === 'applying' ? 'animate-spin' : undefined} aria-hidden="true" />
          {status.label}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <Link to={`/r/${owner}/${repo}`} className="font-mono hover:text-foreground">
          {item.repository}
        </Link>
        <span>
          {item.files} file(s) · +{item.additions} / -{item.deletions}
        </span>
        {item.viaFork ? <Badge variant="muted">via fork</Badge> : null}
        <span>{timeAgo(item.createdAt)}</span>
        {item.pullRequestUrl ? (
          <a href={item.pullRequestUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
            PR #{item.pullRequestNumber}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ReviewRow({ item }) {
  const [owner, repo] = item.repository.split('/');
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/r/${owner}/${repo}/pulls/${item.number}`} className="min-w-0 flex-1 truncate text-xs font-medium hover:text-primary">
          #{item.number} {item.title}
        </Link>
        <Badge variant={RISK[item.riskLevel] || 'muted'} className="shrink-0">
          {item.riskLevel} risk
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span className="font-mono">{item.repository}</span>
        <span>
          {item.findings} finding(s) · {item.verdict.replace('_', ' ')}
        </span>
        {item.trigger === 'webhook' ? <Badge variant="muted">webhook</Badge> : null}
        <span>{timeAgo(item.createdAt)}</span>
      </div>
    </div>
  );
}

function JobRow({ item }) {
  const variants = { completed: 'success', failed: 'danger', running: 'primary', queued: 'muted', cancelled: 'muted' };
  const [owner, repo] = item.repository.split('/');
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-xs">{item.message || item.stage}</p>
        <Badge variant={variants[item.status] || 'muted'} className="shrink-0">
          {item.status}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <Link to={`/r/${owner}/${repo}`} className="font-mono hover:text-foreground">
          {item.repository}
        </Link>
        <span>{item.kind.replace('_', ' ')}</span>
        {item.processedFiles ? <span>{item.processedFiles} files</span> : null}
        <span>{timeAgo(item.createdAt)}</span>
      </div>
    </div>
  );
}
