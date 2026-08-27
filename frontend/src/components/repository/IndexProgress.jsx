import { AlertTriangle, Database, FileCode2, Layers, Loader2, Braces } from 'lucide-react';
import { Progress } from '../ui/primitives.jsx';
import { Alert } from '../ui/feedback.jsx';
import { formatNumber } from '../../lib/utils.js';

const STAGE_LABELS = {
  queued: 'Waiting for a worker…',
  starting: 'Starting…',
  metadata: 'Reading repository metadata…',
  tree: 'Listing repository files…',
  fetching: 'Fetching source files…',
  embedding: 'Generating embeddings…',
  graph: 'Building the code relationship graph…',
  cleanup: 'Removing stale vectors…',
  done: 'Done',
  failed: 'Failed',
  requeued: 'Requeued after a worker restart…',
};

/**
 * Real indexing progress. Every number here comes from the IndexJob document —
 * files discovered, files processed, chunks, embeddings, symbols, edges.
 */
export function IndexProgress({ job, className }) {
  if (!job) return null;
  const running = ['queued', 'running'].includes(job.status);
  const failed = job.status === 'failed';

  const rows = [
    { icon: FileCode2, label: 'Files discovered', value: job.totalFiles },
    { icon: Layers, label: 'Source files', value: job.sourceFiles },
    { icon: FileCode2, label: 'Files processed', value: job.processedFiles },
    { icon: Braces, label: 'Chunks created', value: job.chunksCreated },
    { icon: Database, label: 'Embeddings generated', value: job.embeddingsGenerated },
    { icon: Braces, label: 'Symbols extracted', value: job.symbolsExtracted },
  ];

  return (
    <div className={className}>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {running ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" /> : null}
            <p className="truncate text-xs font-medium">
              {job.message || STAGE_LABELS[job.stage] || 'Indexing…'}
            </p>
          </div>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{job.progress}%</span>
        </div>

        <Progress
          value={job.progress}
          className="mt-3"
          indicatorClassName={failed ? 'bg-destructive' : job.status === 'completed' ? 'bg-success' : undefined}
          aria-label="Indexing progress"
        />

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {rows.map(({ icon: Icon, label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </dt>
              <dd className="font-mono text-sm">{formatNumber(value ?? 0)}</dd>
            </div>
          ))}
        </dl>

        {job.issues?.length ? (
          <details className="mt-3 rounded-md border border-border bg-surface/60 p-2.5">
            <summary className="cursor-pointer text-2xs font-medium text-muted-foreground">
              {job.issues.length} file(s) skipped
            </summary>
            <ul className="mt-2 space-y-1">
              {job.issues.map((issue, index) => (
                <li key={`${issue.filePath}-${index}`} className="font-mono text-2xs text-muted-foreground">
                  {issue.filePath}: {issue.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {failed ? (
        <Alert variant="danger" title="Indexing failed" className="mt-3" icon={AlertTriangle}>
          {job.message || 'The job failed. Check the backend logs and retry.'}
        </Alert>
      ) : null}
    </div>
  );
}
