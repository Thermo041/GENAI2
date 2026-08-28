import { useState } from 'react';
import { toast } from 'sonner';
import { GitCompare, Sparkles, Wand2 } from 'lucide-react';
import { aiApi, changeApi } from '../../services/endpoints.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Badge, Label, Mono, Textarea } from '../../components/ui/primitives.jsx';
import { Alert, EmptyState, ErrorState, LoadingLines } from '../../components/ui/feedback.jsx';
import { ChangeReview } from '../../components/changes/ChangeReview.jsx';
import { ApplyDialog } from '../../components/changes/ApplyDialog.jsx';
import { timeAgo } from '../../lib/utils.js';

const EXAMPLES = [
  'Add validation that rejects negative or zero payment amounts.',
  'Return a 404 instead of throwing when the record is missing.',
  'Add a defensive null check before using the user object.',
];

export default function ChangesTab() {
  const { owner, repo, indexed, canWrite, startIndexing, isIndexing, repository } = useRepository();
  const { user } = useAuth();
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const history = useAsync(() => changeApi.list(owner, repo), [owner, repo], { cacheKey: `changes:${owner}/${repo}` });

  const generate = async (event) => {
    event?.preventDefault();
    const text = instruction.trim();
    if (text.length < 6) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const data = await aiApi.generateChange({ owner, repo, instruction: text });
      setCurrent(data.change);
      setSuggestions(data.suggestions);
      toast.success('Change proposed — review the diff before accepting');
      history.refresh();
    } catch (error) {
      setGenerateError(error);
      toast.error(error.message);
    } finally {
      setGenerating(false);
    }
  };

  const openChange = async (id) => {
    try {
      const data = await changeApi.get(id);
      setCurrent(data.change);
      setSuggestions(data.suggestions);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const reject = async () => {
    if (!current) return;
    setRejecting(true);
    try {
      await changeApi.reject(current.id);
      toast.info('Change rejected — nothing was pushed');
      setCurrent({ ...current, status: 'rejected' });
      history.refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRejecting(false);
    }
  };

  if (!indexed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Wand2}
          title="Index this repository to generate changes"
          description="Patches are written against retrieved code and validated against the current commit, so the repository must be indexed first."
          action={
            <Button size="sm" loading={isIndexing} onClick={() => startIndexing({})}>
              Index repository
            </Button>
          }
        />
      </div>
    );
  }

  const changes = history.data?.changes || [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Wand2 className="size-3.5 text-primary" aria-hidden="true" />
            Describe the change you want
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={generate} className="space-y-2.5">
            <Label htmlFor="instruction" className="sr-only">
              Change instruction
            </Label>
            <Textarea
              id="instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="e.g. Add validation for negative payment amounts in the payment service."
              rows={3}
              className="text-xs"
              disabled={generating}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setInstruction(example)}
                    className="rounded border border-border bg-card px-2 py-1 text-2xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <Button type="submit" loading={generating} disabled={instruction.trim().length < 6}>
                <Sparkles aria-hidden="true" />
                Generate change
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              CodeWeave retrieves the relevant files, asks for a minimal patch, validates it against the current commit,
              and shows you the diff. Nothing is written to GitHub until you accept.
            </p>
          </form>

          {generating ? (
            <div className="mt-4 space-y-2 rounded-md border border-border bg-surface/50 p-3">
              <p className="text-xs text-muted-foreground">Retrieving context, generating the patch and validating it…</p>
              <LoadingLines lines={3} />
            </div>
          ) : null}

          {generateError ? <ErrorState className="mt-4" error={generateError} title="Could not generate a safe change" /> : null}
        </CardContent>
      </Card>

      {current ? (
        <ChangeReview
          change={current}
          canWrite={canWrite}
          rejecting={rejecting}
          onReject={reject}
          onAccept={() => setApplyOpen(true)}
        />
      ) : null}

      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <GitCompare className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Change history for this repository
        </h2>
        {history.loading ? (
          <LoadingLines lines={3} />
        ) : changes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes proposed for this repository yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <button type="button" onClick={() => openChange(change.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-xs font-medium hover:text-primary">{change.summary || change.instruction}</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {change.files?.length ?? 0} file(s) · +{change.totalAdditions} / -{change.totalDeletions} ·{' '}
                    {timeAgo(change.createdAt)}
                    {change.headBranch ? (
                      <>
                        {' · '}
                        <Mono>{change.headBranch}</Mono>
                      </>
                    ) : null}
                  </p>
                </button>
                <div className="flex items-center gap-1.5">
                  {change.viaFork ? <Badge variant="muted">fork</Badge> : null}
                  <Badge variant={change.status === 'pr_open' || change.status === 'committed' ? 'success' : change.status === 'failed' ? 'danger' : 'primary'}>
                    {change.status.replace('_', ' ')}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!canWrite && repository?.access?.canFork === false ? (
        <Alert variant="warning" title="CodeWeave cannot fork this repository for you">
          {repository.access.forkNote}
        </Alert>
      ) : !canWrite ? (
        <Alert variant="info" title="Read-only repository">
          You can analyse, ask questions and generate changes. Accepting a change forks the repository under your account
          and opens the pull request upstream — CodeWeave never pushes to a repository you cannot write to.
        </Alert>
      ) : null}

      <ApplyDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        change={current}
        suggestions={suggestions}
        canWrite={canWrite}
        access={repository?.access}
        viewerLogin={user?.login}
        onApplied={(result) => {
          setCurrent(result.change);
          history.refresh();
        }}
      />
    </div>
  );
}
