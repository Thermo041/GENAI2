import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/button.jsx';
import { Wordmark } from '../components/layout/Logo.jsx';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <Wordmark to="/" tagline />
      <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-card">
        <Compass className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="max-w-sm text-xs text-muted-foreground">
          That route does not exist in CodeWeave. Head back to the dashboard and pick a repository.
        </p>
      </div>
      <Button asChild>
        <Link to="/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}
