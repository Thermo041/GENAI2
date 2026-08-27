import { Brain, GitFork, GitPullRequest, Network, Radar, ShieldCheck, Workflow, Boxes } from 'lucide-react';

export const FEATURES = [
  {
    icon: Brain,
    title: 'Codebase intelligence',
    description:
      'Ask questions in plain English and get answers grounded in your actual code. Every claim cites the file and line range it came from, so you can verify it in one click.',
    detail: 'Hybrid retrieval: MiniLM embeddings in Qdrant + AST symbol lookup + one dependency-graph hop.',
  },
  {
    icon: Radar,
    title: 'Impact analysis',
    description:
      'Before you change a function, see what depends on it — direct callers, importing modules, exposed API routes and the tests that cover it, each with a severity.',
    detail: 'Severity comes from the parsed dependency graph, not from a language-model guess.',
  },
  {
    icon: Workflow,
    title: 'AI code changes',
    description:
      'Describe the change you want. CodeWeave produces a minimal patch, validates that it applies cleanly to the current commit, and shows you a real diff to accept or reject.',
    detail: 'Nothing reaches GitHub until you accept. Patches that fail validation are refused, not forced.',
  },
  {
    icon: GitFork,
    title: 'Fork & pull request flow',
    description:
      'No write access to a repository? CodeWeave forks it under your account, branches from the reviewed commit, commits there, and opens the pull request upstream.',
    detail: 'Write access is read from GitHub, never inferred from ownership.',
  },
  {
    icon: GitPullRequest,
    title: 'AI pull request review',
    description:
      'Reviews read the diff plus the surrounding code, the dependency graph and the test files — then report typed findings with an honest confidence level.',
    detail: 'CONFIRMED · LIKELY · POSSIBLE · INSUFFICIENT CONTEXT. Never an automatic approval.',
  },
];

export const STEPS = [
  {
    title: 'Connect GitHub',
    body: 'Authorize the CodeWeave GitHub App. Tokens stay on the server, encrypted; the browser only ever holds a session cookie.',
  },
  {
    title: 'Index a repository',
    body: 'CodeWeave reads the tree, filters out noise, parses source with a real AST parser, chunks around symbols and embeds each chunk.',
  },
  {
    title: 'Ask and analyze',
    body: 'Questions are answered from retrieved code. Impact analysis walks the stored graph of imports, calls, routes and tests.',
  },
  {
    title: 'Ship a pull request',
    body: 'Accept a proposed change and CodeWeave creates a branch, commits, pushes and opens a PR — your default branch is never touched.',
  },
];

export const STACK = [
  { label: 'GitHub App', detail: 'user authorization + webhooks' },
  { label: 'Qdrant Cloud', detail: '384-dim vector search' },
  { label: 'all-MiniLM-L6-v2', detail: 'local ONNX embeddings' },
  { label: 'Groq', detail: 'low-latency inference' },
  { label: 'MongoDB Atlas', detail: 'graph + jobs + history' },
  { label: 'Babel AST', detail: 'symbols, calls, routes' },
];

export const GUARANTEES = [
  { icon: ShieldCheck, text: 'Repository content is treated as untrusted data — prompt injection in a README cannot redirect the model.' },
  { icon: Network, text: 'Retrieval is scoped per repository, so one project can never surface another project’s code.' },
  { icon: Boxes, text: 'No repository code is ever executed. CodeWeave only reads, parses and analyses it.' },
];
