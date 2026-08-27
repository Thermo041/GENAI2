import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

export function timeAgo(input) {
  if (!input) return '—';
  const date = new Date(input);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '—';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secondsInUnit] of units) {
    const value = Math.floor(seconds / secondsInUnit);
    if (value >= 1) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-value, unit);
  }
  return 'just now';
}

export function formatDateTime(input) {
  if (!input) return '—';
  return new Date(input).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 7) : '';
}

/** Splits `owner/repo` into parts, tolerating extra segments. */
export function splitFullName(fullName) {
  const [owner, repo] = String(fullName || '').split('/');
  return { owner: owner || '', repo: repo || '' };
}

export function fileName(path) {
  return String(path || '').split('/').pop();
}

export function fileExtension(path) {
  const base = fileName(path);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

const MONACO_LANGUAGES = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', kt: 'kotlin',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php', cs: 'csharp', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', swift: 'swift', dart: 'dart', sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', html: 'html',
  css: 'css', scss: 'scss', less: 'less', json: 'json', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', xml: 'xml', md: 'markdown', mdx: 'markdown', vue: 'html',
  svelte: 'html', graphql: 'graphql', gql: 'graphql', dockerfile: 'dockerfile',
};

export function monacoLanguage(path) {
  if (/dockerfile/i.test(fileName(path))) return 'dockerfile';
  return MONACO_LANGUAGES[fileExtension(path)] || 'plaintext';
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
