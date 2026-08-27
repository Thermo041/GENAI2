import { Activity as ActivityIcon, Database, GitCompare, GitPullRequest, RefreshCw } from 'lucide-react';
import { systemApi } from '../services/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader } from '../components/ui/card.jsx';
import { ErrorState, LoadingRows } from '../components/ui/feedback.jsx';
import { ActivityFeed } from '../components/activity/ActivityFeed.jsx';

export default function Activity() {
  const { data, error, loading, refresh } = useAsync(() => systemApi.activity(), [], { cacheKey: 'activity' });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <SectionHeader
        title="Activity"
        description="Everything CodeWeave has done for your repositories"
        icon={ActivityIcon}
        actions={
          <Button size="xs" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorState error={error} onRetry={refresh} /> : null}

      <section className="space-y-3">
        <SectionHeader title="AI changes" icon={GitCompare} />
        {loading ? <LoadingRows rows={3} /> : <ActivityFeed items={data?.changes} kind="changes" />}
      </section>

      <section className="space-y-3">
        <SectionHeader title="AI pull request reviews" icon={GitPullRequest} />
        {loading ? <LoadingRows rows={3} /> : <ActivityFeed items={data?.reviews} kind="reviews" />}
      </section>

      <section className="space-y-3">
        <SectionHeader title="Indexing jobs" icon={Database} />
        {loading ? <LoadingRows rows={3} /> : <ActivityFeed items={data?.jobs} kind="jobs" />}
      </section>
    </div>
  );
}
