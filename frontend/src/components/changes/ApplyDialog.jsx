import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GitBranch, GitFork, GitPullRequest, ShieldAlert } from 'lucide-react';
import { changeApi } from '../../services/endpoints.js';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog.jsx';
import { Button } from '../ui/button.jsx';
import { Input, Label, Mono, Textarea, Switch, Badge } from '../ui/primitives.jsx';
import { Alert } from '../ui/feedback.jsx';

/**
 * The accept flow. Everything the user is about to do is shown before it
 * happens: target repository (fork or origin), branch name, commit message and
 * pull request. The default branch is never a commit target.
 */
export function ApplyDialog({ open, onOpenChange, change, suggestions, canWrite, viewerLogin, onApplied }) {
  const [branchName, setBranchName] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [createPullRequest, setCreatePullRequest] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !change) return;
    setBranchName(suggestions?.branchName || '');
    setCommitMessage(suggestions?.commitMessage || change.summary || '');
    setPrTitle(suggestions?.commitMessage || change.summary || '');
    setPrBody(suggestions?.prBody || '');
    setCreatePullRequest(true);
    setError(null);
  }, [open, change, suggestions]);

  if (!change) return null;

  const viaFork = !canWrite;
  const targetRepo = viaFork ? `${viewerLogin}/${change.baseRepo}` : `${change.baseOwner}/${change.baseRepo}`;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await changeApi.accept(change.id, {
        branchName: branchName.trim() || undefined,
        commitMessage: commitMessage.trim() || undefined,
        prTitle: prTitle.trim() || undefined,
        prBody: prBody.trim() || undefined,
        createPullRequest,
      });
      toast.success(result.message, {
        description: result.pullRequest ? `${result.head.owner}/${result.head.repo}:${result.head.branch} → ${change.baseOwner}/${change.baseRepo}:${change.baseBranch}` : undefined,
        action: result.pullRequest
          ? {
              label: 'Open PR',
              onClick: () => window.open(result.pullRequest.url, '_blank', 'noreferrer'),
            }
          : undefined,
      });
      onApplied?.(result);
      onOpenChange(false);
    } catch (err) {
      setError(err);
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Apply this change to GitHub</DialogTitle>
          <DialogDescription>
            CodeWeave will create a branch, commit the reviewed files and{createPullRequest ? ' open a pull request' : ' stop before opening a pull request'}.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {viaFork ? (
            <Alert variant="warning" title="You don't have write access to this repository" icon={GitFork}>
              CodeWeave will use a fork under your GitHub account (<Mono>{targetRepo}</Mono>), branch there, commit, and
              open the pull request against <Mono>{change.baseOwner}/{change.baseRepo}:{change.baseBranch}</Mono>. Nothing
              is pushed to the upstream repository directly.
            </Alert>
          ) : (
            <Alert variant="info" title="Write access confirmed by GitHub" icon={ShieldAlert}>
              The commit goes to a new branch in <Mono>{targetRepo}</Mono>. Your default branch{' '}
              <Mono>{change.baseBranch}</Mono> is never modified directly.
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="branch-name">Branch name</Label>
              <Input
                id="branch-name"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-2xs text-muted-foreground">
                If it already exists, CodeWeave appends a suffix instead of overwriting it.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commit-message">Commit message</Label>
              <Input id="commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
              <p className="text-2xs text-muted-foreground">
                {change.files.length} file(s) · +{change.totalAdditions} / -{change.totalDeletions}
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <GitPullRequest className="size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-xs font-medium">Open a pull request</p>
                  <p className="text-2xs text-muted-foreground">
                    {viaFork ? `${viewerLogin}:${branchName || 'branch'}` : branchName || 'branch'} →{' '}
                    {change.baseOwner}/{change.baseRepo}:{change.baseBranch}
                  </p>
                </div>
              </div>
              <Switch checked={createPullRequest} onCheckedChange={setCreatePullRequest} aria-label="Open a pull request" />
            </div>

            {createPullRequest ? (
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pr-title">Pull request title</Label>
                  <Input id="pr-title" value={prTitle} onChange={(event) => setPrTitle(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pr-body">Description</Label>
                  <Textarea
                    id="pr-body"
                    value={prBody}
                    onChange={(event) => setPrBody(event.target.value)}
                    rows={7}
                    className="font-mono text-2xs"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Files in this commit</p>
            <ul className="space-y-1">
              {change.files.map((file) => (
                <li key={file.path} className="flex items-center justify-between gap-2 rounded border border-border bg-card px-2 py-1">
                  <Mono className="truncate text-2xs">{file.path}</Mono>
                  <span className="shrink-0 font-mono text-2xs">
                    <span className="text-success">+{file.additions}</span> <span className="text-destructive">-{file.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {error ? (
            <Alert variant="danger" title="GitHub refused this change">
              {error.message}
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            <GitBranch aria-hidden="true" />
            {viaFork ? 'Fork, commit' : 'Create branch, commit'}
            {createPullRequest ? ' & open PR' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
