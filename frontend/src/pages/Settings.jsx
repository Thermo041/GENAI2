import { CheckCircle2, ExternalLink, Moon, Settings as SettingsIcon, Sun, XCircle } from 'lucide-react';
import { GithubIcon } from '../components/ui/icons.jsx';
import { systemApi } from '../services/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, SectionHeader } from '../components/ui/card.jsx';
import { Badge, Mono, Switch, Separator } from '../components/ui/primitives.jsx';
import { LoadingLines } from '../components/ui/feedback.jsx';

function ServiceRow({ label, ok, detail }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
        ) : (
          <XCircle className="size-3.5 text-destructive" aria-hidden="true" />
        )}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="truncate font-mono text-2xs text-muted-foreground">{detail}</span>
    </div>
  );
}

export default function Settings() {
  const { user, installations, installUrl, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const health = useAsync(() => systemApi.health(true), []);
  const data = health.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <SectionHeader title="Settings" description="Account, appearance and service status" icon={SettingsIcon} />

      <Card>
        <CardHeader>
          <CardTitle>GitHub account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-9 rounded-full" /> : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name || user?.login}</p>
              <p className="truncate font-mono text-2xs text-muted-foreground">@{user?.login}</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-medium">App installations</p>
            {installations?.length ? (
              <ul className="space-y-1.5">
                {installations.map((installation) => (
                  <li key={installation.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5">
                    <span className="text-xs">
                      {installation.account}
                      <span className="ml-1.5 text-2xs text-muted-foreground">({installation.accountType})</span>
                    </span>
                    <Badge variant="outline">
                      {installation.repositorySelection === 'all' ? 'all repositories' : 'selected repositories'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">
                No installations yet. Install the app to work with private repositories, forks and pull requests.
              </p>
            )}
            {installUrl ? (
              <Button size="xs" variant="outline" asChild>
                <a href={installUrl} target="_blank" rel="noreferrer noopener">
                  <GithubIcon />
                  Manage on GitHub
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isDark ? <Moon className="size-4 text-muted-foreground" aria-hidden="true" /> : <Sun className="size-4 text-muted-foreground" aria-hidden="true" />}
              <div>
                <p className="text-xs font-medium">{isDark ? 'Dark theme' : 'Light theme'}</p>
                <p className="text-2xs text-muted-foreground">Dark is the CodeWeave default; the choice is saved to your account.</p>
              </div>
            </div>
            <Switch checked={isDark} onCheckedChange={toggleTheme} aria-label="Toggle dark theme" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service status</CardTitle>
        </CardHeader>
        <CardContent>
          {health.loading ? (
            <LoadingLines lines={5} />
          ) : health.error ? (
            <p className="text-xs text-destructive">{health.error.message}</p>
          ) : (
            <div className="divide-y divide-border">
              <ServiceRow label="MongoDB Atlas" ok={data?.mongo?.state === 'connected'} detail={data?.mongo?.db || data?.mongo?.state} />
              <ServiceRow
                label="Qdrant Cloud"
                ok={Boolean(data?.qdrant?.reachable)}
                detail={data?.qdrant?.reachable ? `${data.qdrant.collection} · ${data.qdrant.points} points · ${data.qdrant.vectors}d` : data?.qdrant?.error}
              />
              <ServiceRow label="Groq" ok={Boolean(data?.groq?.reachable)} detail={data?.groq?.models?.main || data?.groq?.error} />
              <ServiceRow label="GitHub App" ok={Boolean(data?.github?.reachable)} detail={data?.github?.app || data?.github?.error} />
              <ServiceRow
                label="Embeddings"
                ok={Boolean(data?.embeddings?.reachable)}
                detail={data?.embeddings?.reachable ? `${data.embeddings.model} · ${data.embeddings.dim}d · ${data.embeddings.ms}ms` : data?.embeddings?.error}
              />
            </div>
          )}
          {data?.github?.permissions ? (
            <p className="mt-3 border-t border-border pt-3 text-2xs text-muted-foreground">
              App permissions:{' '}
              <Mono>
                {Object.entries(data.github.permissions)
                  .map(([key, value]) => `${key}:${value}`)
                  .join('  ')}
              </Mono>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="destructive" onClick={logout}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
