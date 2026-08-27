import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils.js';

/** The CodeWeave mark: a woven "C" built from three strands. */
export function Logo({ className, size = 20 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className={cn('text-primary', className)}
      aria-hidden="true"
    >
      <path d="M20 6.4A8.6 8.6 0 0 0 5.6 12" />
      <path d="M4 17.6A8.6 8.6 0 0 0 18.4 12" />
      <path d="M8.2 4.6c3.4 2 5.6 4.6 5.6 7.4s-2.2 5.4-5.6 7.4" opacity="0.55" />
      <circle cx="5.6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Wordmark({ className, to = '/', tagline = false, size = 20 }) {
  const content = (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Logo size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight text-foreground">CodeWeave</span>
        {tagline ? <span className="mt-0.5 text-2xs text-muted-foreground">Understand. Analyze. Evolve.</span> : null}
      </span>
    </span>
  );
  if (!to) return content;
  return (
    <Link to={to} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </Link>
  );
}
