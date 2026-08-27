import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, FileDiff, Rows3, Columns2, X } from 'lucide-react';
import { DiffViewer } from '../code/CodeViewer.jsx';
import { Button } from '../ui/button.jsx';
import { Badge, Mono, Separator } from '../ui/primitives.jsx';
import { Alert } from '../ui/feedback.jsx';
import { Tabs, TabsList, TabsTrigger } from '../ui/overlays.jsx';
import { cn, timeAgo } from '../../lib/utils.js';

const STATUS_TONE = {
  proposed: 'primary',
  applying: 'primary',
  committed: 'success',
  pr_open: 'success',
  rejected: 'muted',
  failed: 'danger',
};

/**
 * Full review surface for an AI-proposed change: summary, warnings, per-file
 * Monaco diff, and the accept/reject actions. Nothing here writes to GitHub —
 * accepting opens the ApplyDialog, which does.
 */
export function ChangeReview({ change, onAccept, onReject, rejecting, canWrite }) {
  const [activeFile, setActiveFile] = useState(change.files[0]?.path);
  const [inline, setInline] = useState(false);
  const file = change.files.find((f) => f.path === activeFile) || change.files[0];
  const settled = ['committed', 'pr_open', 'rejected'].includes(change.status);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">AI proposed change</h2>
              <Badge variant={STATUS_TONE[change.status] || 'muted'}>{change.status.replace('_', ' ')}</Badge>
              {change.viaFork ? <Badge variant="muted">via fork</Badge> : null}
              {change.model ? <Badge variant="outline">{change.model}</Badge> : null}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{change.summary}</p>
            <p className="text-2xs text-muted-foreground">
              requested {timeAgo(change.createdAt)} · base <Mono>{change.baseBranch}</Mono> at{' '}
              <Mono>{(change.baseCommitSha || '').slice(0, 7)}</Mono>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {change.status === 'proposed' ? (
              <>
                <Button size="sm" variant="outline" onClick={onReject} loading={rejecting}>
                  <X aria-hidden="true" />
                  Reject
                </Button>
                <Button size="sm" onClick={onAccept}>
                  <Check aria-hidden="true" />
                  Accept change
                </Button>
              </>
            ) : null}
            {change.pullRequestUrl ? (
              <Button size="sm" variant="outline" asChild>
                <a href={change.pullRequestUrl} target="_blank" rel="noreferrer noopener">
                  Pull request #{change.pullRequestNumber}
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>

        {change.reasoning ? (
          <>
            <Separator />
            <div className="p-4">
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Why</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{change.reasoning}</p>
            </div>
          </>
        ) : null}

        {change.statusMessage ? (
          <>
            <Separator />
            <p className="p-4 text-xs text-muted-foreground">{change.statusMessage}</p>
          </>
        ) : null}
      </div>

      {change.warnings?.length ? (
        <Alert variant="warning" title="Review notes from the model" icon={AlertTriangle}>
          <ul className="space-y-1">
            {change.warnings.map((warning) => (
              <li key={warning}>· {warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {change.impactedSymbols?.length ? (
        <Alert variant="info" title="Callers worth double-checking">
          <div className="flex flex-wrap gap-1.5">
            {change.impactedSymbols.map((symbol) => (
              <Mono key={symbol} className="rounded border border-border bg-card px-1.5 py-0.5 text-2xs">
                {symbol}
              </Mono>
            ))}
          </div>
        </Alert>
      ) : null}

      {!canWrite && change.status === 'proposed' ? (
        <Alert variant="warning" title="Read-only repository">
          Accepting will fork the repository under your account, commit there, and open the pull request upstream.
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2">
          <Tabs value={activeFile} onValueChange={setActiveFile}>
            <TabsList className="flex-wrap">
              {change.files.map((entry) => (
                <TabsTrigger key={entry.path} value={entry.path} className="max-w-[18rem]">
                  <FileDiff aria-hidden="true" />
                  <span className="truncate">{entry.path.split('/').pop()}</span>
                  <span className="font-mono text-2xs">
                    <span className="text-success">+{entry.additions}</span>
                    <span className="ml-1 text-destructive">-{entry.deletions}</span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant={inline ? 'ghost' : 'secondary'}
              onClick={() => setInline(false)}
              aria-label="Side by side diff"
            >
              <Columns2 aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant={inline ? 'secondary' : 'ghost'} onClick={() => setInline(true)} aria-label="Inline diff">
              <Rows3 aria-hidden="true" />
            </Button>
          </div>
        </div>

        {file ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/50 px-3 py-1.5">
              <Mono className="truncate text-2xs">{file.path}</Mono>
              <span className="font-mono text-2xs text-muted-foreground">
                {file.action === 'create' ? 'new file' : 'modified'} · +{file.additions} / -{file.deletions}
              </span>
            </div>
            {file.rationale ? (
              <p className="border-b border-border bg-surface/30 px-3 py-2 text-2xs text-muted-foreground">{file.rationale}</p>
            ) : null}
            <DiffViewer
              path={file.path}
              original={file.originalContent}
              modified={file.modifiedContent}
              inline={inline}
              height="26rem"
              className={cn('bg-card', settled && 'opacity-90')}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
