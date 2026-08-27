import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { GithubIcon } from '../components/ui/icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Wordmark } from '../components/layout/Logo.jsx';
import { Button } from '../components/ui/button.jsx';
import { Alert } from '../components/ui/feedback.jsx';

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'CodeWeave uses the GitHub App flow',
    body: 'No personal access tokens. You authorize the app, GitHub issues a short-lived user token, and CodeWeave refreshes it server-side.',
  },
  {
    icon: Lock,
    title: 'Your token never reaches the browser',
    body: 'Tokens are encrypted with AES-256-GCM in MongoDB. The browser only holds an httpOnly session cookie.',
  },
  {
    icon: GithubIcon,
    title: 'Your GitHub permissions are the limit',
    body: 'CodeWeave can only read what your account can read, and can only write where GitHub reports push access.',
  },
];

export default function Login() {
  const { login } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const error = params.get('error');
  const intent = params.get('intent');
  const returnTo = location.state?.from || '/dashboard';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Wordmark to="/" />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft aria-hidden="true" />
              Back
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-12 sm:px-6">
        <div className="grid w-full gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Connect your GitHub account</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {intent === 'public'
                ? 'Analyzing any public repository still needs a GitHub identity — it is what keeps API rate limits workable and lets CodeWeave open pull requests from your fork.'
                : 'CodeWeave reads repositories through your own GitHub permissions, so what you can see is exactly what it can analyse.'}
            </p>

            {error ? (
              <Alert variant="danger" title="GitHub authorization failed" className="mt-5">
                {error}
              </Alert>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => login(returnTo)}>
                <GithubIcon />
                Continue with GitHub
              </Button>
            </div>

            <p className="mt-4 text-2xs leading-relaxed text-muted-foreground">
              After authorizing, install the app on the accounts or repositories you want CodeWeave to work with. You can
              change that selection on GitHub at any time.
            </p>
          </div>

          <ul className="space-y-3">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  <p className="text-xs font-semibold">{title}</p>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
