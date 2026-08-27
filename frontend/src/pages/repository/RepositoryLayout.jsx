import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Boxes,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCompare,
  GitPullRequest,
  LayoutTemplate,
  Radar,
  RefreshCw,
  Sparkles,
  Play,
} from 'lucide-react';
import { RepositoryProvider, useRepository } from '../../context/RepositoryContext.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Mono } from '../../components/ui/primitives.jsx';
import { Alert, ErrorState, LoadingLines } from '../../components/ui/feedback.jsx';
import { AccessBadge, IndexBadge, StaleBadge, VisibilityBadge } from '../../components/repository/Badges.jsx';
import { IndexProgress } from '../../components/repository/IndexProgress.jsx';
import { cn, shortSha } from '../../lib/utils.js';

const TABS = [
  { to: '', label: 'Overview', icon: LayoutTemplate, end: true },
  { to: 'files', label: 'Files', icon: FileCode2 },
  { to: 'assistant', label: 'AI Assistant', icon: Sparkles },
  { to: 'impact', label: 'Impact', icon: Radar },
  { to: 'changes', label: 'Changes', icon: GitCompare },
  { to: 'architecture', label: 'Architecture', icon: Boxes },
  { to: 'pulls', label: 'Pull Requests', icon: GitPullRequest },
];

function Workspace() {
  const { owner, repo, repository, loading, error, refresh, isIndexing, job, startIndexing, indexed } = useRepository();
  const location = useLocation();
  const isFilesView = location.pathname.endsWith('/files');

  if (loading && !repository) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <LoadingLines lines={2} />
        <LoadingLines lines={6} />
      </div>
    );
  }

  if (error && !repository) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ErrorState error={error} onRetry={refresh} title="Cannot open this repository" />
      </div>
    );
  }

  const freshness = repository?.freshness;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="border-b border-border bg-surface/40">
        <div className={cn('px-4 pt-4 sm:px-6', isFilesView ? 'max-w-none' : 'mx-auto max-w-6xl')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight">
                  <span className="text-muted-foreground">{owner}/</span>
                  {repo}
                </h1>
                <VisibilityBadge visibility={repository?.visibility} isFork={repository?.isFork} />
                <AccessBadge access={repository?.access} />
                <IndexBadge status={repository?.index?.status} />
                <StaleBadge freshness={freshness} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="size-3" aria-hidden="true" />
                  <Mono>{repository?.index?.branch || repository?.defaultBranch}</Mono>
                </span>
                {repository?.index?.commitSha ? (
                  <span>
                    indexed at <Mono>{shortSha(repository.index.commitSha)}</Mono>
                  </span>
                ) : null}
                {repository?.parentFullName ? <span>forked from {repository.parentFullName}</span> : null}
                <a
                  href={repository?.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  GitHub
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="xs" variant="ghost" onClick={refresh} disabled={loading}>
                <RefreshCw aria-hidden="true" />
                Refresh
              </Button>
              <Button
                size="sm"
                variant={indexed ? 'outline' : 'default'}
                loading={isIndexing}
                onClick={() => startIndexing({ force: indexed })}
              >
                <Play aria-hidden="true" />
                {isIndexing ? 'Indexing…' : indexed ? 'Re-index' : 'Index repository'}
              </Button>
            </div>
          </div>

          <nav className="-mb-px mt-4 flex gap-1 overflow-x-auto scrollbar-thin" aria-label="Repository sections">
            {TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )
                }
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {isIndexing && job ? (
        <div className={cn('px-4 pt-4 sm:px-6', isFilesView ? 'max-w-none' : 'mx-auto w-full max-w-6xl')}>
          <IndexProgress job={job} />
        </div>
      ) : null}

      {freshness?.stale && !isIndexing ? (
        <div className={cn('px-4 pt-4 sm:px-6', isFilesView ? 'max-w-none' : 'mx-auto w-full max-w-6xl')}>
          <Alert
            variant="warning"
            title="This repository has changed since it was last indexed"
            actions={
              <Button size="xs" onClick={() => startIndexing({ force: true })}>
                Re-index repository
              </Button>
            }
          >
            Branch head is <Mono>{shortSha(freshness.headSha)}</Mono>, index is at{' '}
            <Mono>{shortSha(freshness.indexedSha)}</Mono>
            {freshness.headMessage ? ` — latest commit: “${freshness.headMessage}”` : ''}. Answers may be out of date.
          </Alert>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export default function RepositoryLayout() {
  return (
    <RepositoryProvider>
      <Workspace />
    </RepositoryProvider>
  );
}
