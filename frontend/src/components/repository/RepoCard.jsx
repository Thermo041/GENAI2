import { Link } from 'react-router-dom';
import { Boxes, FileCode2, GitBranch, Radar, Sparkles, Star } from 'lucide-react';
import { Card } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { Mono } from '../ui/primitives.jsx';
import { AccessBadge, IndexBadge, VisibilityBadge } from './Badges.jsx';
import { formatNumber, timeAgo } from '../../lib/utils.js';

/** Repository card used on the dashboard and repositories list. */
export function RepoCard({ repository }) {
  const { owner, name, fullName, description, visibility, isFork, access, index, stars, primaryLanguage } = repository;
  const base = `/r/${owner}/${name}`;
  const indexed = ['indexed', 'partial'].includes(index?.status);

  return (
    <Card interactive className="flex flex-col">
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={base}
              className="block truncate text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {fullName}
            </Link>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {description || 'No description on GitHub.'}
            </p>
          </div>
          <VisibilityBadge visibility={visibility} isFork={isFork} className="shrink-0 whitespace-nowrap" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <AccessBadge access={access} />
          <IndexBadge status={index?.status} />
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Files</dt>
            <dd className="font-mono text-xs">{indexed ? formatNumber(index.files) : '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Symbols</dt>
            <dd className="font-mono text-xs">{indexed ? formatNumber(index.symbols) : '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Chunks</dt>
            <dd className="font-mono text-xs">{indexed ? formatNumber(index.chunks) : '—'}</dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
          {primaryLanguage ? (
            <span className="inline-flex items-center gap-1">
              <FileCode2 className="size-3" aria-hidden="true" />
              {primaryLanguage}
            </span>
          ) : null}
          {index?.branch ? (
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3" aria-hidden="true" />
              <Mono>{index.branch}</Mono>
            </span>
          ) : null}
          {typeof stars === 'number' && stars > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3" aria-hidden="true" />
              {formatNumber(stars)}
            </span>
          ) : null}
          {index?.indexedAt ? <span>indexed {timeAgo(index.indexedAt)}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-border p-2.5">
        <Button size="xs" variant="secondary" asChild>
          <Link to={base}>Open</Link>
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <Link to={`${base}/files`}>
            <FileCode2 aria-hidden="true" />
            Files
          </Link>
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <Link to={`${base}/assistant`}>
            <Sparkles aria-hidden="true" />
            Ask AI
          </Link>
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <Link to={`${base}/impact`}>
            <Radar aria-hidden="true" />
            Impact
          </Link>
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <Link to={`${base}/architecture`}>
            <Boxes aria-hidden="true" />
            Architecture
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export function RepoCardSkeleton() {
  return (
    <Card className="animate-pulse">
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
          <div className="h-6 rounded bg-muted" />
          <div className="h-6 rounded bg-muted" />
          <div className="h-6 rounded bg-muted" />
        </div>
      </div>
    </Card>
  );
}
