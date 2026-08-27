import { Link } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { GithubIcon } from '../components/ui/icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Wordmark } from '../components/layout/Logo.jsx';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/primitives.jsx';
import { PipelineDiagram } from '../components/landing/PipelineDiagram.jsx';
import { FEATURES, GUARANTEES, STACK, STEPS } from '../components/landing/content.js';

export default function Landing() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Wordmark to="/" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button size="sm" onClick={() => login('/dashboard')}>
              <GithubIcon />
              Connect GitHub
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 grid-backdrop" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
              <div>
                <Badge variant="outline" className="mb-5">
                  GitHub App · RAG · AST analysis
                </Badge>
                <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                  CodeWeave
                  <span className="mt-2 block text-xl font-normal text-muted-foreground sm:text-2xl">
                    Understand. Analyze. Evolve.
                  </span>
                </h1>
                <p className="mt-5 max-w-xl text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
                  AI-powered codebase intelligence for GitHub repositories. Index a repository once, then ask questions
                  with cited answers, trace what a change would break, and ship AI-written patches as real pull requests.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Button size="lg" onClick={() => login('/dashboard')}>
                    <GithubIcon />
                    Connect GitHub
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/login?intent=public">
                      <Search aria-hidden="true" />
                      Analyze public repository
                    </Link>
                  </Button>
                </div>

                <ul className="mt-7 space-y-2">
                  {GUARANTEES.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      {text}
                    </li>
                  ))}
                </ul>
              </div>

              <PipelineDiagram />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-b border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Built for real repositories</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Five capabilities, each backed by something concrete: a vector index, a parsed dependency graph, GitHub
                permissions, and patch validation that can say no.
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, description, detail }) => (
                <article key={title} className="rounded-lg border border-border bg-card p-4 shadow-subtle">
                  <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
                  <p className="mt-3 border-t border-border pt-3 font-mono text-2xs leading-relaxed text-muted-foreground/80">
                    {detail}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">How it works</h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-lg border border-border bg-card p-4">
                  <span className="font-mono text-2xs text-muted-foreground">0{index + 1}</span>
                  <h3 className="mt-1 text-sm font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Stack */}
        <section className="border-b border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Under the hood</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STACK.map(({ label, detail }) => (
                <div key={label} className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                  <span className="text-xs font-medium">{label}</span>
                  <span className="font-mono text-2xs text-muted-foreground">{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section>
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="flex flex-col items-start justify-between gap-5 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Point it at a repository you know well</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  The fastest way to judge CodeWeave is to ask it something only someone who read the code could answer.
                </p>
              </div>
              <Button size="lg" onClick={() => login('/dashboard')}>
                Connect GitHub
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark to={null} tagline />
          <p className="text-2xs text-muted-foreground">
            Requires the CodeWeave GitHub App with Contents (read &amp; write), Pull requests (read &amp; write) and
            Metadata (read-only).
          </p>
        </div>
      </footer>
    </div>
  );
}
