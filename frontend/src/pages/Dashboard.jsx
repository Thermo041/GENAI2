import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FolderGit2, GitCompare, GitPullRequest, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { repoApi, systemApi } from '../services/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, SectionHeader } from '../components/ui/card.jsx';
import { Input } from '../components/ui/primitives.jsx';
import { Alert, EmptyState, ErrorState, LoadingRows, StatTile } from '../components/ui/feedback.jsx';
import { RepoCard, RepoCardSkeleton } from '../components/repository/RepoCard.jsx';
import { ActivityFeed } from '../components/activity/ActivityFeed.jsx';
import { formatNumber } from '../lib/utils.js';

export default function Dashboard() {
  const { user, hasInstallation, installUrl } = useAuth();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const repositories = useAsync(() => repoApi.listAnalyzed(), [], { cacheKey: 'repos:analyzed' });
  const activity = useAsync(() => systemApi.activity(), [], { cacheKey: 'activity' });

  const analyze = async (event) => {
    event.preventDefault();
    if (!url.trim()) return;
    setAnalyzing(true);
    try {
      const { repository } = await repoApi.analyze(url.trim());
      toast.success(`Opened ${repository.fullName}`);
      navigate(`/r/${repository.owner}/${repository.name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const list = repositories.data?.repositories || [];
  const indexedCount = list.filter((r) => ['indexed', 'partial'].includes(r.index?.status)).length;
  const changes = activity.data?.changes || [];
  const reviews = activity.data?.reviews || [];
  const openPrs = changes.filter((c) => c.status === 'pr_open').length;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back{user?.name || user?.login ? `, ${(user.name || user.login).split(' ')[0]}` : ''}
        </h1>
        <p className="text-xs text-muted-foreground">
          Index a repository, ask questions with cited answers, and ship AI changes as pull requests.
        </p>
      </header>

      {!hasInstallation && installUrl ? (
        <Alert
          variant="warning"
          title="Install the CodeWeave GitHub App"
          actions={
            <Button size="xs" asChild>
              <a href={installUrl} target="_blank" rel="noreferrer noopener">
                Install on GitHub
              </a>
            </Button>
          }
        >
          Public repositories work already. Private repositories, forks and pull requests need the app installed on the
          account that owns them.
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Repositories" value={formatNumber(list.length)} icon={FolderGit2} hint="analysed by you" />
        <StatTile label="Indexed" value={formatNumber(indexedCount)} icon={Search} tone="primary" hint="ready for AI features" />
        <StatTile label="AI changes" value={formatNumber(changes.length)} icon={GitCompare} hint="proposals you created" />
        <StatTile label="Pull requests" value={formatNumber(openPrs)} icon={GitPullRequest} tone="success" hint="opened by CodeWeave" />
      </section>

      <Card>
        <form onSubmit={analyze} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="analyze-url" className="text-xs font-medium">
              Analyze any GitHub repository
            </label>
            <Input
              id="analyze-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              spellCheck={false}
            />
            <p className="text-2xs text-muted-foreground">
              Public repositories work without extra setup. Private repositories need your GitHub account to have access.
            </p>
          </div>
          <Button type="submit" loading={analyzing} disabled={!url.trim()}>
            <Plus aria-hidden="true" />
            Analyze
          </Button>
        </form>
      </Card>

      <section className="space-y-3">
        <SectionHeader
          title="Your repositories"
          description="Repositories you have analysed with CodeWeave"
          icon={FolderGit2}
          actions={
            <>
              <Button size="xs" variant="ghost" onClick={repositories.refresh} disabled={repositories.loading}>
                <RefreshCw aria-hidden="true" />
                Refresh
              </Button>
              <Button size="xs" variant="outline" asChild>
                <Link to="/repositories">Browse GitHub repositories</Link>
              </Button>
            </>
          }
        />

        {repositories.loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <RepoCardSkeleton key={index} />
            ))}
          </div>
        ) : repositories.error ? (
          <ErrorState error={repositories.error} onRetry={repositories.refresh} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No repositories analysed yet"
            description="Paste a GitHub URL above, or browse the repositories your GitHub account can reach."
            action={
              <Button size="sm" variant="outline" asChild>
                <Link to="/repositories">Browse repositories</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((repository) => (
              <RepoCard key={repository.id} repository={repository} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <SectionHeader title="Recent AI changes" icon={GitCompare} />
          {activity.loading ? <LoadingRows rows={2} /> : <ActivityFeed items={changes} kind="changes" />}
        </div>
        <div className="space-y-3">
          <SectionHeader title="Recent AI reviews" icon={GitPullRequest} />
          {activity.loading ? <LoadingRows rows={2} /> : <ActivityFeed items={reviews} kind="reviews" />}
        </div>
      </section>
    </div>
  );
}
