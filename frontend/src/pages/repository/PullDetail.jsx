import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, FileDiff, GitCommit, MessageSquarePlus, RefreshCw, Sparkles } from 'lucide-react';
import { githubApi } from '../../services/endpoints.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Badge, Mono, Skeleton } from '../../components/ui/primitives.jsx';
import { Alert, EmptyState, ErrorState, LoadingLines, StatTile } from '../../components/ui/feedback.jsx';
import { ConfirmDialog } from '../../components/ui/dialog.jsx';
import { ReviewFindings } from '../../components/pullRequests/ReviewFindings.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../../lib/utils.js';

function DiffBlock({ file }) {
  return (
    <details className="overflow-hidden rounded-md border border-border bg-card" open={file.changes < 120}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Mono className="truncate">{file.path}</Mono>
          <Badge variant="muted">{file.status}</Badge>
        </span>
        <span className="shrink-0 font-mono text-2xs">
          <span className="text-success">+{file.additions}</span> <span className="text-destructive">-{file.deletions}</span>
        </span>
      </summary>
      {file.patch ? (
        <pre className="max-h-96 overflow-auto border-t border-border bg-surface/50 p-3 font-mono text-2xs leading-relaxed scrollbar-thin">
          {file.patch.split('\n').map((line, index) => (
            <div
              key={index}
              className={
                line.startsWith('+') && !line.startsWith('+++')
                  ? 'bg-success/10 text-success'
                  : line.startsWith('-') && !line.startsWith('---')
                    ? 'bg-destructive/10 text-destructive'
                    : line.startsWith('@@')
                      ? 'text-primary'
                      : 'text-muted-foreground'
              }
            >
              {line || ' '}
            </div>
          ))}
        </pre>
      ) : (
        <p className="border-t border-border p-3 text-2xs text-muted-foreground">GitHub returned no text patch for this file.</p>
      )}
    </details>
  );
}

export default function PullDetail() {
  const { number } = useParams();
  const { owner, repo, indexed, setOpenFile } = useRepository();
  const navigate = useNavigate();
  const [reviewing, setReviewing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const { data, error, loading, refresh, setData } = useAsync(() => githubApi.pull(owner, repo, number), [owner, repo, number], { cacheKey: `pull:${owner}/${repo}#${number}` });

  const runReview = async (postToGithub = false) => {
    const setBusy = postToGithub ? setPublishing : setReviewing;
    setBusy(true);
    try {
      const result = await githubApi.review(owner, repo, number, { postToGithub, force: true });
      setData((current) => ({ ...current, review: { ...result.review, stale: false } }));
      toast.success(
        postToGithub ? 'Review generated and published to GitHub' : `Review complete — ${result.review.findings.length} finding(s)`,
      );
      setPublishOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openFile = (target) => {
    setOpenFile(target);
    navigate('../../files', { relative: 'path' });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
        <Skeleton className="h-6 w-1/2" />
        <LoadingLines lines={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <ErrorState error={error} onRetry={refresh} title="Cannot load this pull request" />
      </div>
    );
  }

  const pull = data?.pullRequest;
  const review = data?.review;
  const files = data?.files || [];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="xs" variant="ghost" asChild>
          <Link to="../" relative="path">
            <ArrowLeft aria-hidden="true" />
            All pull requests
          </Link>
        </Button>
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
          <Button size="xs" variant="outline" asChild>
            <a href={pull.url} target="_blank" rel="noreferrer noopener">
              GitHub
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-base font-semibold tracking-tight">
          <span className="text-muted-foreground">#{pull.number}</span> {pull.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <Badge variant={pull.state === 'open' ? 'success' : pull.state === 'merged' ? 'primary' : 'muted'}>{pull.state}</Badge>
          <span>@{pull.author}</span>
          <span>
            <Mono>{pull.head.repo}:{pull.head.ref}</Mono> → <Mono>{pull.base.ref}</Mono>
          </span>
          <span>opened {timeAgo(pull.createdAt)}</span>
          {pull.mergedAt ? <span>merged {formatDateTime(pull.mergedAt)}</span> : null}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Files changed" value={formatNumber(pull.changedFiles ?? files.length)} />
        <StatTile label="Additions" value={`+${formatNumber(pull.additions ?? 0)}`} tone="success" />
        <StatTile label="Deletions" value={`-${formatNumber(pull.deletions ?? 0)}`} tone="danger" />
        <StatTile label="Commits" value={formatNumber(pull.commits ?? data?.commits?.length ?? 0)} icon={GitCommit} />
      </section>

      {!indexed ? (
        <Alert variant="warning" title="This repository is not indexed">
          The AI review still reads the diff, but it cannot use dependency-graph context until the repository is indexed.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>AI pull request review</CardTitle>
            <div className="flex items-center gap-1.5">
              <Button size="xs" loading={reviewing} onClick={() => runReview(false)}>
                <Sparkles aria-hidden="true" />
                {review ? 'Re-run review' : 'Run AI review'}
              </Button>
              {review ? (
                <Button size="xs" variant="outline" onClick={() => setPublishOpen(true)}>
                  <MessageSquarePlus aria-hidden="true" />
                  Publish to GitHub
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reviewing ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Reading the diff, the current file contents, dependents from the graph and related tests…
              </p>
              <LoadingLines lines={4} />
            </div>
          ) : review ? (
            <ReviewFindings review={review} onOpenFile={openFile} />
          ) : (
            <EmptyState
              compact
              icon={Sparkles}
              title="No AI review yet"
              description="The review reads the diff plus repository context, then reports typed findings with an honest confidence level."
            />
          )}
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Changed files</h2>
        {files.length === 0 ? (
          <p className="text-xs text-muted-foreground">GitHub reported no changed files.</p>
        ) : (
          <div className="space-y-1.5">
            {files.map((file) => (
              <DiffBlock key={file.path} file={file} />
            ))}
          </div>
        )}
      </section>

      {data?.commits?.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Commits</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {data.commits.map((commit) => (
              <li key={commit.sha} className="flex items-center gap-2 p-2.5 text-xs">
                <Mono className="shrink-0 text-muted-foreground">{commit.sha.slice(0, 7)}</Mono>
                <span className="truncate">{commit.message.split('\n')[0]}</span>
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{commit.author}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish this review to GitHub?"
        description="CodeWeave will post the findings as a review comment on the pull request. It never approves or requests changes on your behalf."
        confirmLabel="Publish review"
        loading={publishing}
        onConfirm={() => runReview(true)}
      />
    </div>
  );
}
