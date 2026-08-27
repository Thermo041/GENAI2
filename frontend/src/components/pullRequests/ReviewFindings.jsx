import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert, TestTube2, Zap } from 'lucide-react';
import { Badge, Mono } from '../ui/primitives.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Alert, EmptyState } from '../ui/feedback.jsx';
import { AiMarkdown } from '../ai/AiMarkdown.jsx';

const SEVERITY_TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'muted' };
const CONFIDENCE_META = {
  CONFIRMED: { tone: 'danger', icon: ShieldAlert, label: 'CONFIRMED' },
  LIKELY: { tone: 'warning', icon: AlertTriangle, label: 'LIKELY' },
  POSSIBLE: { tone: 'outline', icon: HelpCircle, label: 'POSSIBLE' },
  INSUFFICIENT_CONTEXT: { tone: 'muted', icon: HelpCircle, label: 'INSUFFICIENT CONTEXT' },
};
const VERDICT_COPY = {
  approve: { tone: 'success', text: 'No blocking issues found' },
  comment: { tone: 'primary', text: 'Comments for the author' },
  request_changes: { tone: 'danger', text: 'Changes requested' },
};

/** Renders one stored AI review: verdict, risk, typed findings, gaps. */
export function ReviewFindings({ review, onOpenFile }) {
  if (!review) return null;
  const verdict = VERDICT_COPY[review.verdict] || VERDICT_COPY.comment;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-1.5">
              <Zap className="size-3.5 text-primary" aria-hidden="true" />
              AI review
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Badge variant={SEVERITY_TONE[review.riskLevel]}>{review.riskLevel} risk</Badge>
              <Badge variant={verdict.tone}>{verdict.text}</Badge>
              {review.stale ? <Badge variant="warning">new commits since review</Badge> : null}
              {review.trigger === 'webhook' ? <Badge variant="muted">webhook</Badge> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <AiMarkdown text={review.summary} onOpenFile={onOpenFile} />
          <p className="border-t border-border pt-2.5 text-2xs text-muted-foreground">
            {review.filesReviewed} file(s) reviewed · +{review.additions} / -{review.deletions}
            {review.model ? ` · ${review.model}` : ''}
            {review.postedToGithub && review.githubCommentUrl ? (
              <>
                {' · '}
                <a href={review.githubCommentUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                  published on GitHub
                </a>
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      {review.findings?.length ? (
        <ul className="space-y-2">
          {review.findings.map((finding, index) => {
            const confidence = CONFIDENCE_META[finding.confidence] || CONFIDENCE_META.POSSIBLE;
            const ConfidenceIcon = confidence.icon;
            return (
              <li key={`${finding.filePath}-${finding.line}-${index}`} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_TONE[finding.severity]} className="w-16 justify-center">
                    {finding.severity}
                  </Badge>
                  <Badge variant={confidence.tone}>
                    <ConfidenceIcon aria-hidden="true" />
                    {confidence.label}
                  </Badge>
                  {finding.category ? <Badge variant="outline">{finding.category}</Badge> : null}
                  <p className="text-xs font-semibold">{finding.title}</p>
                </div>

                {finding.filePath ? (
                  <button
                    type="button"
                    onClick={() => onOpenFile?.({ path: finding.filePath, startLine: finding.line || 1, endLine: finding.line || 1 })}
                    className="mt-1.5 block font-mono text-2xs text-primary hover:underline"
                  >
                    {finding.filePath}
                    {finding.line ? `:${finding.line}` : ''}
                  </button>
                ) : null}

                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{finding.issue}</p>
                <p className="mt-2 border-l-2 border-primary/40 pl-2.5 text-xs leading-relaxed text-foreground/90">
                  {finding.recommendation}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={CheckCircle2}
          title="No findings"
          description="The reviewer did not find anything worth flagging in this diff."
        />
      )}

      {review.testGaps?.length ? (
        <Alert variant="warning" title="Test gaps" icon={TestTube2}>
          <ul className="space-y-1">
            {review.testGaps.map((gap) => (
              <li key={gap}>· {gap}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {review.breakingChanges?.length ? (
        <Alert variant="danger" title="Possible breaking changes">
          <ul className="space-y-1">
            {review.breakingChanges.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {review.contextFiles?.length ? (
        <p className="text-2xs text-muted-foreground">
          Context used:{' '}
          {review.contextFiles.map((path) => (
            <Mono key={path} className="mr-1.5">
              {path}
            </Mono>
          ))}
        </p>
      ) : null}
    </div>
  );
}
