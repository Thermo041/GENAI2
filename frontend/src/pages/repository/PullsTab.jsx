import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, GitMerge, GitPullRequest, RefreshCw, Sparkles } from 'lucide-react';
import { githubApi } from '../../services/endpoints.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { Badge, Mono } from '../../components/ui/primitives.jsx';
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/feedback.jsx';
import { timeAgo } from '../../lib/utils.js';

const STATES = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed & merged' },
  { id: 'all', label: 'All' },
];

const RISK_TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'success' };

export default function PullsTab() {
  const { owner, repo } = useRepository();
  const [state, setState] = useState('open');
  const { data, error, loading, refresh } = useAsync(() => githubApi.pulls(owner, repo, state), [owner, repo, state], { cacheKey: `pulls:${owner}/${repo}:${state}` });
  const pulls = data?.pulls || [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {STATES.map((option) => (
            <Button
              key={option.id}
              size="xs"
              variant={state === option.id ? 'secondary' : 'ghost'}
              onClick={() => setState(option.id)}
              aria-pressed={state === option.id}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Button size="xs" variant="ghost" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : pulls.length === 0 ? (
        <EmptyState
          icon={GitPullRequest}
          title={`No ${state === 'all' ? '' : state} pull requests`}
          description="Pull requests CodeWeave opens from accepted AI changes will appear here too."
        />
      ) : (
        <Card className="divide-y divide-border">
          {pulls.map((pull) => (
            <article key={pull.number} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`${pull.number}`}
                    className="truncate text-xs font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    #{pull.number} {pull.title}
                  </Link>
                  <Badge variant={pull.state === 'merged' ? 'primary' : pull.state === 'open' ? 'success' : 'muted'}>
                    {pull.state === 'merged' ? <GitMerge aria-hidden="true" /> : <GitPullRequest aria-hidden="true" />}
                    {pull.state}
                  </Badge>
                  {pull.isDraft ? <Badge variant="muted">draft</Badge> : null}
                  {pull.aiReview ? (
                    <Badge variant={RISK_TONE[pull.aiReview.riskLevel] || 'muted'}>
                      <Sparkles aria-hidden="true" />
                      AI: {pull.aiReview.findings} finding(s){pull.aiReview.stale ? ' · stale' : ''}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-2xs text-muted-foreground">
                  <span>@{pull.author}</span>
                  <span>
                    <Mono>{pull.head.ref}</Mono> → <Mono>{pull.base.ref}</Mono>
                  </span>
                  {pull.head.repo && pull.head.repo !== pull.base.repo ? <Badge variant="muted">from fork</Badge> : null}
                  <span>updated {timeAgo(pull.updatedAt)}</span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="xs" variant="secondary" asChild>
                  <Link to={`${pull.number}`}>Review</Link>
                </Button>
                <Button size="icon-sm" variant="ghost" asChild>
                  <a href={pull.url} target="_blank" rel="noreferrer noopener" aria-label={`Open pull request #${pull.number} on GitHub`}>
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </article>
          ))}
        </Card>
      )}
    </div>
  );
}
