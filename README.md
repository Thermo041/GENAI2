# CodeWeave

**Understand. Analyze. Evolve.**

AI-powered codebase intelligence for GitHub repositories. Index a repository once, then ask
questions that are answered from your real code with clickable citations, trace what a change would
break, and ship AI-written patches as real pull requests.

CodeWeave is a full-stack JavaScript application: React + Vite frontend, Node + Express backend,
MongoDB Atlas, Qdrant Cloud, local ONNX embeddings, Groq for inference, and a GitHub App for
authentication and repository access.

---

## What it does

| Capability | How it actually works |
| --- | --- |
| **Codebase Q&A** | Hybrid retrieval — MiniLM vectors in Qdrant + AST symbol lookup + one dependency-graph hop — then a grounded Groq answer that cites `path:startLine-endLine`. |
| **Impact analysis** | Walks the AST-derived graph in MongoDB: direct callers, importing modules, exposed HTTP routes, test coverage. Severity is computed from the graph, not guessed by the model. |
| **AI code changes** | Structured JSON patch (full content or line-range edits), validated against the current commit before anything is written. Shown as a Monaco diff to accept or reject. |
| **Branch → commit → PR** | Accepting a change creates a CodeWeave branch, commits with the git data API, pushes and opens a pull request. The default branch is never a commit target. |
| **Fork workflow** | No write access? CodeWeave forks the repository under your account, branches from the reviewed upstream commit, commits there and opens the PR upstream. |
| **AI PR review** | Reads the diff plus current file contents, graph dependents and test files. Findings are typed `CONFIRMED / LIKELY / POSSIBLE / INSUFFICIENT_CONTEXT`. Never auto-approves. |
| **Webhooks** | Signature-verified deliveries, deduplicated by `X-GitHub-Delivery`. `push` re-embeds only the changed files; `pull_request` queues an AI review. |
| **Repository overview** | Deterministic facts (languages, entry points, routes, frameworks, data stores, manifests) narrated by the model, cached per indexed commit. |

Nothing is mocked. If a credential is missing the server refuses to start and tells you which one;
it never substitutes fake data.

---

## Architecture

```
                          ┌─────────────────────────────┐
                          │  React 19 + Vite + Tailwind │
                          │  Monaco viewer / diff        │
                          └──────────────┬──────────────┘
                            REST + SSE (httpOnly session cookie + CSRF)
                                         │
                          ┌──────────────▼──────────────┐
                          │   Node 22 + Express 5 API    │
                          │   in-process job worker      │
                          └───┬────────┬────────┬───────┘
                              │        │        │
              ┌───────────────┘        │        └────────────────┐
              ▼                        ▼                         ▼
      GitHub REST (Octokit)     MongoDB Atlas              AI services
      • user authorization      • users (encrypted          • Groq (gpt-oss-120b)
      • repos / tree / blobs      GitHub tokens)            • all-MiniLM-L6-v2
      • branches / commits      • repositories, jobs          (ONNX, in-process)
      • forks / pull requests   • CodeFile / CodeSymbol      • Qdrant Cloud
      • webhooks                  / CodeEdge graph             (384-dim vectors)
                                • conversations, changes,
                                  PR reviews, deliveries
```
### Indexing pipeline

```
GitHub tree ─► filter (noise/binaries/size) ─► priority scoring ─► fetch blobs (concurrency 6)
     └─► AST parse (Babel for JS/TS, regex extractors for 12 more languages)
            └─► symbol-aware chunking ─► MiniLM embeddings (batched)
                   ├─► Qdrant upsert   (payload: repositoryId, owner, repo, branch, commit, file, symbol, lines)
                   └─► MongoDB graph   (CodeFile · CodeSymbol · CodeEdge: imports/calls/defines/tests/routes)
```

Progress counters (files discovered, processed, chunks, embeddings, symbols, edges) are written to
the `IndexJob` document after every batch and streamed to the UI over SSE.

---

## Tech stack

**Frontend** React 19, Vite 8, JavaScript (no TypeScript), Tailwind CSS 3, shadcn-style components on
Radix primitives, lucide-react, Monaco (self-hosted, lazy-loaded), sonner, axios, React Router 7.

**Backend** Node 22, Express 5, Mongoose 9, Octokit (App + user auth, retry + throttling plugins),
`@babel/parser`/`@babel/traverse`, `@huggingface/transformers` (ONNX), `@qdrant/js-client-rest`,
`@langchain/groq` + `@langchain/core`, zod, pino, express-session + connect-mongo, helmet,
express-rate-limit, diff.

**Data** MongoDB Atlas (documents + job queue + sessions), Qdrant Cloud (vectors).

**AI** Groq `openai/gpt-oss-120b` (main) and `openai/gpt-oss-20b` (fast), `Xenova/all-MiniLM-L6-v2`
embeddings running locally in the Node process (384 dimensions, cosine).

**Tests** Vitest + Supertest (124 tests), plus two live verification scripts.

---

## Project structure

```
GENAII2/
├── backend/
│   ├── scripts/
│   │   ├── checkServices.js      # verifies Mongo, Qdrant, Groq, GitHub App, embeddings
│   │   ├── e2eVerify.js          # full pipeline against a real public repository
│   │   ├── warmEmbeddings.js     # downloads/warms the ONNX model
│   │   └── webhookSmoke.js       # signed webhook deliveries end to end
│   ├── src/
│   │   ├── config/               # env (+validation), db, github, groq, qdrant
│   │   ├── controllers/          # auth, repository, indexing, ai, change, github, pullRequest, webhook, system
│   │   ├── jobs/                 # in-process worker + standalone worker entry
│   │   ├── middleware/           # auth, csrf, rateLimit, validate, requestLogger, errorHandler, webhookVerify
│   │   ├── models/               # User, Repository, Conversation, IndexJob, CodeChange,
│   │   │                         # PullRequestReview, CodeFile, CodeSymbol, CodeEdge, WebhookDelivery
│   │   ├── routes/               # auth, repository, ai, change, github, webhook
│   │   ├── services/
│   │   │   ├── ai/               # prompts, groqService, retrieval, chat, impact, overview, budget, rateLimiter, schemas
│   │   │   ├── analysis/         # jsAst, genericSymbols, analyzeFile, chunker, graphBuilder, impactGraph, overview
│   │   │   ├── codeModification/ # generateChange, patchValidator, applyChange
│   │   │   ├── embeddings/       # index (provider switch), localProvider, hfProvider
│   │   │   ├── github/           # client, oauth, repositories, contents, writes, pulls, errors
│   │   │   ├── indexing/         # indexer, incremental, fileSelection, jobs
│   │   │   ├── pullRequests/     # review
│   │   │   ├── qdrant/           # store
│   │   │   ├── repositoryAccess.js
│   │   │   └── repositoryView.js
│   │   ├── utils/                # errors, http, crypto, logger, fileFilter, repoIdentity
│   │   ├── app.js                # express wiring
│   │   └── server.js             # boot + graceful shutdown
│   ├── tests/                    # vitest suites
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/           # ui/ layout/ repository/ code/ ai/ changes/ pullRequests/ activity/ landing/
│   │   ├── context/              # AuthContext, ThemeContext, RepositoryContext
│   │   ├── hooks/                # useAsync, useIndexProgress
│   │   ├── lib/                  # utils, monacoSetup
│   │   ├── pages/                # Landing, Login, Dashboard, Repositories, Changes, Activity, Settings
│   │   │   └── repository/       # RepositoryLayout + Overview/Files/Assistant/Impact/Changes/Architecture/Pulls/PullDetail
│   │   ├── services/             # api (axios + CSRF + 401), endpoints
│   │   ├── App.jsx / main.jsx / index.css
│   ├── .env.example
│   └── package.json
├── render.yaml                   # Render blueprint (API + static site)
├── PROGRESS.md
└── README.md
```
---

## Prerequisites

- **Node.js 20.11+** (developed on 22.12) and npm 10+
- A **GitHub account** that can create a GitHub App
- **MongoDB Atlas** cluster (free M0 works)
- **Qdrant Cloud** cluster (free tier works)
- **Groq** API key (free tier works — see the token-budget note below)
- ~200 MB of disk for the embedding model cache (downloaded once)

No Docker, no Python, no Redis.

---

## Local setup

```bash
git clone <your-fork-url> codeweave && cd codeweave

# 1) Backend
cd backend
npm install
cp .env.example .env        # then fill it in (see the sections below)
npm run check:services      # must print PASS for all six checks
npm run dev                 # http://localhost:5000

# 2) Frontend (second terminal)
cd ../frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm run dev                 # http://localhost:5173
```

Open <http://localhost:5173>, click **Connect GitHub**, authorize the app, then install it on the
accounts/repositories you want to work with.

### Backend environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | – | `development` locally, `production` on Render |
| `PORT` | – | Defaults to 5000. Render injects its own value. |
| `CLIENT_URL` | ✅ | Frontend origin, used for CORS + OAuth redirects |
| `SERVER_URL` | ✅ | Public backend origin |
| `MONGODB_URI` | ✅ | Include a database name, e.g. `.../codeweave?retryWrites=true&w=majority` |
| `GITHUB_APP_ID` | ✅ | GitHub App → General → App ID |
| `GITHUB_APP_SLUG` | ✅ | The URL slug, used to build the install link |
| `GITHUB_CLIENT_ID` | ✅ | App client ID (`Iv23...`) |
| `GITHUB_CLIENT_SECRET` | ✅ | Generated in the App settings |
| `GITHUB_CALLBACK_URL` | ✅ | `<SERVER_URL>/api/auth/github/callback` |
| `GITHUB_PRIVATE_KEY_PATH` | dev | Path to the downloaded `.pem` (PKCS#1 is converted automatically) |
| `GITHUB_PRIVATE_KEY` | prod | Inline PEM with literal `\n`; takes precedence over the path |
| `GITHUB_WEBHOOK_SECRET` | ✅ | Same value as in the App's webhook settings |
| `GITHUB_WEBHOOK_URL` | – | Informational; shown in setup docs |
| `GROQ_API_KEY` | ✅ | console.groq.com |
| `GROQ_MODEL` / `GROQ_MODEL_FAST` | – | Defaults `openai/gpt-oss-120b` / `openai/gpt-oss-20b` |
| `GROQ_MAX_TOKENS` | – | Hard ceiling per completion (default 4096) |
| `GROQ_TPM_LIMIT` | – | **Tokens per minute of your Groq plan (default 8000).** Prompt sizes are derived from this. |
| `GROQ_TIMEOUT_MS` | – | Default 90000 |
| `QDRANT_URL` / `QDRANT_API_KEY` | ✅ | Cluster endpoint + key |
| `QDRANT_COLLECTION` | – | Default `codeweave_chunks`, created automatically |
| `EMBEDDING_PROVIDER` | – | `local` (default, ONNX in-process) or `hf` (hosted inference) |
| `EMBEDDING_MODEL` | – | `Xenova/all-MiniLM-L6-v2` |
| `EMBEDDING_DIM` | – | 384 — must match the Qdrant collection |
| `EMBEDDING_BATCH_SIZE` | – | Default 16; lower it on small dynos |
| `HF_TOKEN` | if `hf` | Hugging Face token for hosted inference |
| `SESSION_SECRET` | ✅ | `openssl rand -hex 48` |
| `ENCRYPTION_KEY` | ✅ | `openssl rand -hex 32` — exactly 64 hex chars (AES-256-GCM) |
| `MAX_FILES` | – | Files indexed per repository (default 500) |
| `MAX_FILE_SIZE` | – | Per-file byte ceiling (default 180000) |
| `MAX_CHUNK_CHARS` | – | Chunk size before splitting (default 1800) |
| `MAX_TOTAL_CHUNKS` | – | Per-repository chunk ceiling (default 6000) |
| `INDEX_CONCURRENCY` | – | Parallel blob fetches (default 6) |
| `WORKER_ENABLED` | – | `true` runs the job worker inside the API process |
| `WORKER_POLL_MS` | – | Queue poll interval (default 2500) |

### Frontend environment variables

| Variable | Notes |
| --- | --- |
| `VITE_API_URL` | Backend origin, e.g. `http://localhost:5000` or `https://codeweave-api.onrender.com` |

`.env` files are gitignored. `*.pem` is gitignored too — never commit the App private key.
---

## GitHub App configuration

CodeWeave authenticates through a **GitHub App with user authorization**. There are no Personal
Access Tokens anywhere in the product.

### Create the app

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**

| Field | Value (local development) | Value (production) |
| --- | --- | --- |
| GitHub App name | `codeweave-<yourname>` | same |
| Homepage URL | `http://localhost:5173` | `https://codeweave-web.onrender.com` |
| **Callback URL** | `http://localhost:5000/api/auth/github/callback` | `https://codeweave-api.onrender.com/api/auth/github/callback` |
| Request user authorization (OAuth) during installation | ✅ checked | ✅ checked |
| Expire user authorization tokens | ✅ checked (recommended) | ✅ checked |
| Setup URL | `http://localhost:5173/dashboard` | `https://codeweave-web.onrender.com/dashboard` |
| **Webhook → Active** | ✅ | ✅ |
| **Webhook URL** | your tunnel, e.g. `https://<id>.ngrok-free.app/api/github/webhook` | `https://codeweave-api.onrender.com/api/github/webhook` |
| **Webhook secret** | same string as `GITHUB_WEBHOOK_SECRET` | same |
| Where can this app be installed | Any account | Any account |

You can add **both** callback URLs to one app (GitHub allows multiple), so a single app serves local
development and production.

### Repository permissions (minimum required)

| Permission | Level | Why CodeWeave needs it |
| --- | --- | --- |
| **Contents** | Read & write | Read the tree, blobs and file contents for indexing; create branches and commits for accepted AI changes. |
| **Pull requests** | Read & write | List/read pull requests and diffs, create pull requests, post the AI review comment. |
| **Metadata** | Read-only | Mandatory for every app; repository metadata, branches, permissions. |

Nothing else is requested — no organization administration, no account permissions, no secrets, no
billing, no workflow scope.

### Subscribe to events

`Push`, `Pull request`, `Installation`, `Installation repositories`.

### Private key

**General → Private keys → Generate a private key.** Download the `.pem`.

- Local: put it beside the repository and set `GITHUB_PRIVATE_KEY_PATH=../your-key.pem`.
- Render: paste the whole PEM into `GITHUB_PRIVATE_KEY` with literal `\n` between lines.

GitHub issues PKCS#1 keys (`BEGIN RSA PRIVATE KEY`); CodeWeave converts them to PKCS#8 at boot, so
either format works.

### What a GitHub App can and cannot see

A GitHub App does **not** grant unlimited access. Effective access is the intersection of:

1. **Installation** — the app must be installed on the account that owns the repository.
2. **Repository selection** — "All repositories" or an explicit list, chosen at install time.
3. **The signed-in user's own GitHub permissions** — CodeWeave acts as the user for every read and
   write, so it can never exceed what that user can do.
4. **Organization policies** — an org can restrict third-party apps entirely.

Consequences you will notice:

- **Public repositories** can be analysed even where the app is not installed: CodeWeave falls back
  to unauthenticated reads for public data (60 requests/hour, so large public repositories are best
  analysed with the app installed).
- **Private repositories** require the app installed on the owning account *and* your account to
  have access, otherwise CodeWeave returns "You don't have access to this repository."
- **Forking** creates the fork under your account, so the app must be installed there (install on
  "All repositories" for your own account to make the fork workflow seamless).

### Webhooks locally

GitHub cannot reach `localhost`, so deliveries need a relay. **Preferred: smee.io** — it is pure
Node, needs no binary, and forwards *only* the webhook path instead of exposing the whole backend:

```bash
cd backend
npm run webhook:proxy -- --new     # prints a channel URL; put it in .env as SMEE_URL
npm run webhook:proxy              # afterwards, reuse the saved channel
```

Paste the printed `https://smee.io/<channel>` into the GitHub App's **Webhook URL**, keep the secret
equal to `GITHUB_WEBHOOK_SECRET`, and tick the four events. Signature verification still applies to
every relayed delivery.

A full tunnel (`ngrok http 5000`) also works, with two caveats worth knowing: it exposes the entire
API, and Windows Defender classifies the ngrok agent as potentially unwanted software (threat family
`2147939874`) and may quarantine the binary — using it means adding a Defender exclusion. ngrok also
enforces a minimum agent version per account, so run `ngrok update` if authentication fails with
`ERR_NGROK_121`.

No relay at all? The handler is fully verifiable locally:

```bash
cd backend && npm run webhook:test     # 11 signed-delivery checks, nothing exposed
```
---

## Service setup

### MongoDB Atlas

1. Create a free **M0** cluster.
2. **Database Access** → add a user with `readWrite` on the `codeweave` database.
3. **Network Access** → allow your IP for development; add `0.0.0.0/0` (or Render's egress IPs) for
   deployment.
4. Copy the SRV connection string and append the database name:
   `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/codeweave?retryWrites=true&w=majority`

Collections and indexes are created automatically on boot (`autoIndex: true`). Sessions live in a
`sessions` collection, encrypted at rest by `connect-mongo`.

### Qdrant Cloud

1. Create a free cluster and copy the **endpoint URL** and **API key**.
2. Set `QDRANT_URL` and `QDRANT_API_KEY`.

On startup CodeWeave creates the collection (`codeweave_chunks`, 384 dimensions, cosine, on-disk
payload) and the payload indexes it filters on: `repositoryId`, `owner`, `repo`, `commitSha`,
`indexRunId`, `filePath`, `language`, `symbolType`, `symbolName`. If an existing collection has a
different vector size, boot fails with a clear message instead of writing mismatched vectors.

### Groq

1. Create an API key at <https://console.groq.com>.
2. Set `GROQ_API_KEY`. Defaults target `openai/gpt-oss-120b` (131k context) and
   `openai/gpt-oss-20b`.
3. `npm run check:services` prints the models your key can actually use and flags a configured model
   that is unavailable.

**Free-tier tokens per minute.** The on-demand tier allows ~8000 tokens/minute across all requests.
CodeWeave handles that in two ways:

- Every prompt is sized from `GROQ_TPM_LIMIT` (`src/services/ai/budget.js`). Large files are sent as
  focused windows around the retrieved code instead of in full, and the model is told to answer with
  line-range `edits`.
- A client-side token governor (`src/services/ai/rateLimiter.js`) reserves the estimated tokens for
  each call in a 60-second sliding window and waits for headroom instead of hitting a 429. Heavy
  one-shot actions (change generation, PR review) wait up to 90 s; interactive chat fails fast with
  "CodeWeave is pacing AI requests…".

Raise `GROQ_TPM_LIMIT` after upgrading your Groq plan and every prompt automatically gets more
context.

### Embeddings

`EMBEDDING_PROVIDER=local` (default) runs **all-MiniLM-L6-v2** as int8 ONNX inside the Node process
through `@huggingface/transformers`. The model (~25 MB) is downloaded once into
`backend/.cache/transformers`; warm it ahead of time with:

```bash
cd backend && npm run warm:embeddings     # prints dimensions + latency
```

Cold load is ~1 s after the first download, and ~130 MB RSS. Vectors are mean-pooled and
L2-normalised, and the dimension is validated on every batch — a provider returning the wrong size
raises an error rather than corrupting the index.

`EMBEDDING_PROVIDER=hf` switches to Hugging Face hosted inference for the same weights (needs
`HF_TOKEN`); the provider interface is the only thing indexing and retrieval depend on.

---

## Running and verifying

```bash
# backend
npm run dev              # watch mode
npm start                # production start
npm run worker           # standalone job worker (set WORKER_ENABLED=false on the API)
npm test                 # 124 vitest tests
npm run check:services   # live check of Mongo, Qdrant, Groq, GitHub App, embeddings
npm run warm:embeddings
npm run webhook:proxy    # relay GitHub deliveries to localhost via smee.io
npm run webhook:test     # 11 signed-delivery checks against a running server

# frontend
npm run dev
npm run build            # production build into dist/
npm run preview          # serve the build locally
```

### Verification scripts

```bash
# READ paths against a real public repository (no credentials beyond .env needed).
# Runs unauthenticated GitHub reads, so keep the file count small.
node scripts/e2eVerify.js hagopj13/node-express-boilerplate 26
node scripts/e2eVerify.js owner/repo 26 --skip-index    # reuse an existing index

# WRITE paths against a repository the App is installed on: index -> RAG -> impact
# -> AI patch -> branch -> commit -> pull request -> AI review posted to GitHub.
npm run seed:demo -- owner/repo        # fills an EMPTY repo with a small Express app
npm run verify:write -- owner/repo     # 18 checks, opens a real pull request
npm run review:pr -- owner/repo 1      # re-review one PR and publish the comment

# Signed webhook deliveries against a running server.
npm run webhook:test
```

`e2eVerify.js` asserts 22 checks: metadata + permission detection, job queue → worker → index,
Mongo graph rows, Qdrant points, per-repository isolation, a grounded RAG answer whose citations all
resolve to indexed files, structural impact analysis with an explanation, and a validated patch that
only touches reviewed files.
---

## API reference

All responses use one envelope:

```json
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "NOT_INDEXED", "message": "Index this repository first." } }
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health?deep=true` | Liveness + per-dependency status |
| GET | `/api/auth/github` | Start GitHub user authorization |
| GET | `/api/auth/github/callback` | OAuth callback → session → redirect to the SPA |
| GET | `/api/auth/me` | Session user, installations, CSRF token |
| POST | `/api/auth/logout` | Destroy the session |
| PATCH | `/api/auth/preferences` | Persist theme choice |
| GET | `/api/activity` | Recent changes, reviews and jobs |
| GET | `/api/github/user` | Authenticated GitHub profile |
| GET | `/api/github/repositories` | Repositories reachable through the installation |
| POST | `/api/github/:owner/:repo/fork` | Create/return your fork (idempotent) |
| POST | `/api/github/:owner/:repo/branches` | Create a branch (never the default branch) |
| POST | `/api/github/:owner/:repo/pull-request` | Open a PR from an existing branch |
| GET | `/api/github/:owner/:repo/pulls` | List pull requests (+ stored AI review summary) |
| GET | `/api/github/:owner/:repo/pulls/:number` | PR detail, files, commits, stored review |
| POST | `/api/github/:owner/:repo/pulls/:number/review` | Run the AI review (`postToGithub`, `force`) |
| GET | `/api/github/:owner/:repo/pulls/:number/review` | Fetch the stored review |
| POST | `/api/github/webhook` | Signed webhook receiver |
| POST | `/api/repositories/analyze` | Resolve a URL/`owner/repo`, record access, return the view |
| GET | `/api/repositories` | Repositories you have analysed |
| GET | `/api/repositories/:owner/:repo` | Metadata + access + index state + freshness |
| GET | `/api/repositories/:owner/:repo/branches` | Branch list |
| GET | `/api/repositories/:owner/:repo/tree` | File tree with indexed markers |
| GET | `/api/repositories/:owner/:repo/file?path=&ref=` | File content + symbols in that file |
| GET | `/api/repositories/:owner/:repo/commits` | Recent commits |
| GET | `/api/repositories/:owner/:repo/symbols?q=` | Symbol search from the AST index |
| GET | `/api/repositories/:owner/:repo/overview` | Deterministic facts + cached narrative (never calls the LLM) |
| POST | `/api/repositories/:owner/:repo/overview` | Generate/refresh the AI narrative (`refresh`) |
| GET | `/api/repositories/:owner/:repo/graph` | Directory-level dependency graph |
| POST | `/api/repositories/:owner/:repo/index` | Queue indexing (`branch`, `force`) |
| GET | `/api/repositories/:owner/:repo/index-status` | Job status + staleness |
| GET | `/api/repositories/:owner/:repo/index-events` | SSE progress stream |
| GET | `/api/repositories/:owner/:repo/jobs` | Job history |
| POST | `/api/ai/chat` | RAG answer with citations |
| POST | `/api/ai/impact-analysis` | Graph + semantic impact + explanation |
| POST | `/api/ai/generate-change` | Propose a validated patch |
| GET | `/api/ai/conversations` · `/api/ai/conversation` | Conversation history |
| GET | `/api/changes` · `/api/changes/:id` | AI change list / detail |
| POST | `/api/changes/:id/accept` | Branch → commit → push → PR (the only write path) |
| POST | `/api/changes/:id/reject` | Mark rejected; nothing is pushed |

Error codes the frontend branches on: `UNAUTHORIZED`, `GITHUB_AUTH_EXPIRED`, `NO_WRITE_ACCESS`,
`PRIVATE_NO_ACCESS`, `REPO_NOT_FOUND`, `NOT_INDEXED`, `STALE_INDEX`, `PATCH_FAILED`,
`GITHUB_RATE_LIMIT`, `RATE_LIMITED`, `AI_RATE_LIMITED`, `AI_OUTPUT_INVALID`, `CONFIGURATION_ERROR`.

---

## Security model

**Authentication.** GitHub App user authorization only. The access token is exchanged server-side,
encrypted with AES-256-GCM (`ENCRYPTION_KEY`) and stored in MongoDB; the browser only ever receives
an httpOnly, `sameSite` session cookie. Expiring user tokens are refreshed automatically with the
stored refresh token, and a dead refresh token surfaces as `GITHUB_AUTH_EXPIRED` → "Reconnect
GitHub" instead of a retry loop.

**Authorization.** Write access is read from GitHub's `permissions` object on every request —
ownership is never used to infer it. `assertWriteAccess` runs server-side before any branch, commit
or PR; hiding buttons in React is treated as cosmetic only. Archived repositories are refused.

**CSRF.** Double-submit cookie: a readable `codeweave.csrf` cookie plus an `X-CSRF-Token` header,
compared with `timingSafeEqual`. Only the webhook route is exempt (it authenticates by HMAC).

**Prompt injection.** Repository content is untrusted input. Every prompt wraps it in
`<repository_context>` delimiters and states that anything inside is data, never instructions —
tested in `tests/aiSafety.test.js`.

**AI output.** Patches are validated with zod, then re-validated structurally: path allow-list,
traversal rejection, existence checks, overlapping/inverted edit rejection, truncation guard,
no-op detection. At accept time the blob SHA **and** content are re-checked against GitHub, so a
patch generated against a stale commit is refused rather than applied.

**Secrets.** pino redacts tokens/keys/cookies by path, and `scrubSecrets` strips token-shaped
strings from any message that reaches a log. Tests assert that GitHub, Groq and PEM patterns are
redacted.

**Other.** helmet, strict CORS allow-list with credentials (never `*`), rate limits per user/IP
(general, AI, heavy AI, indexing, write, auth), zod validation on every body/params, repository path
and branch-name validators, no stack traces in responses, and **no repository code is ever
executed** — CodeWeave only fetches, parses and analyses text.
---

## How the RAG pipeline works

1. **Question → embedding.** The question is embedded with the same MiniLM model used for indexing.
2. **Semantic search.** Qdrant is queried with a `must` filter on `repositoryId`, so repository A can
   never surface repository B's code (asserted in `e2eVerify.js`).
3. **Structural retrieval.** Identifier-shaped tokens in the question (`processPayment`,
   `AuthController`, `user_service`) are matched against `CodeSymbol` names, and the chunk covering
   each symbol is pulled in directly. This is what makes "where is X used?" work when vector
   similarity alone would miss it.
4. **Graph hop.** For the best-scoring files, `CodeEdge` rows give importers and callers; one hop of
   neighbours is added, plus human-readable relationship notes (`a.js:12 createOrder → processPayment`).
5. **Fallback for tiny indexes.** If nothing clears the similarity threshold, CodeWeave falls back to
   the repository's entire stored index (capped) instead of refusing — a three-file static site fits in
   the prompt whole, so the answer can state what the repository *does* contain.
6. **Context assembly.** Chunks are ranked structural → semantic → graph → fallback, then packed into the
   character budget derived from `GROQ_TPM_LIMIT`. Each chunk carries `path:startLine-endLine`.
7. **Grounded answer.** Groq answers under the chat system prompt: cite real files, never invent
   symbols, and reply "I don't have enough repository context…" when even the fallback is empty (in
   that case no model call is made at all, and the reply reports how much *was* indexed).
8. **Citations.** The chunk list becomes a citation array; the UI renders chips and linkifies inline
   `path:line-line` mentions, both of which open the file in Monaco at that line.

Conversations are persisted per `(user, repository)` and the last four turns are replayed for pronoun
resolution only.

## How impact analysis works

`analyzeImpactGraph` (MongoDB, no LLM) resolves the symbol, then queries:

- `calls` / `tests` edges pointing at it → **direct callers** (severity HIGH at confidence ≥ 0.7,
  MEDIUM below, LOW for test files)
- `imports` edges pointing at the defining file → **importing modules** (MEDIUM)
- a second hop: who calls the callers → **indirect reach** (MEDIUM)
- routes declared in affected files → **API exposure** (HIGH)
- test files referencing it → **coverage** (LOW, and "no coverage" is reported explicitly)

Call resolution is import-aware: a call resolves to the symbol in a file the caller actually imports
(confidence 0.95), then a local definition (0.85), then a repository-unique name (0.7); ambiguous
targets are recorded unresolved rather than guessed. Qdrant then adds semantically related files the
graph cannot see, and Groq explains the blast radius while being told to separate structural
certainty from semantic guesses. `riskLevel` comes from the graph counts, not from the prose.

## How the AI modification workflow works

```
instruction
   └─ hybrid retrieval → candidate files ranked (explicit targets first)
        └─ fetch current content at the branch head
             ├─ small file  → full content with display line numbers
             └─ large file  → merged windows around retrieved chunks (edits mode required)
                  └─ + importers/callers from the graph
                       └─ Groq structured JSON (zod-validated, one retry with the error appended)
                            └─ patch validation → unified diff → CodeChange (status: proposed)
```

Accepting (`POST /api/changes/:id/accept`) then runs, server-side and in this order:

1. Re-resolve the repository and permissions from GitHub.
2. If there is no write access → **fork flow** (below); otherwise target the origin repository.
3. Pick a branch name (`codeweave/<slug>-<id>`, user-editable) and make it unique.
4. Create the branch from the **reviewed commit**, never from a moving head.
5. Re-verify every file's blob SHA and content — refuse if anything moved.
6. Commit all files in one commit (blobs → tree → commit → ref) with a guard that refuses the
   default branch.
7. Open the pull request; store number and URL on the change.

## How the fork workflow works

```
upstream:  amit/chat-app  (public, you have read-only access)
                 │  POST /api/github/:owner/:repo/fork  (idempotent — reuses an existing fork)
                 ▼
fork:      rahul/chat-app          ← merge-upstream keeps the default branch current
                 │  branch created from the upstream commit the AI reviewed
                 ▼
branch:    codeweave/add-dark-mode → commit → push
                 │
                 ▼
PR:        rahul:codeweave/add-dark-mode  ──►  amit:main
```

CodeWeave never attempts a push to `amit/chat-app`. Because forks share the upstream object store,
the fork branch is created directly from the reviewed upstream commit, so the patch applies to
byte-identical content; if GitHub refuses that ref, it falls back to the fork's default branch head
and the content check catches any drift. Cross-repo PRs are additionally guarded server-side: a
`head` of `someoneelse:branch` is rejected.

## How the PR review works

The reviewer receives PR metadata, commit subjects, the full changed-file list, per-file patches
(budgeted), the **current content** of the changed files on the head branch, `imports`/`calls` edges
that point *into* the changed files, the repository's test files (with name-matching ones
highlighted), and semantically related code. Output is zod-validated JSON: summary, verdict, risk
level, findings (severity + confidence + file + line + issue + recommendation), test gaps and
breaking changes. Findings referencing files not in the diff are dropped. Publishing to GitHub always
uses `event: COMMENT` — CodeWeave never approves or requests changes on a user's behalf.
---

## Freshness and webhook sync

- `Repository.lastIndexedCommitSha` is compared with the live branch head on every repository load.
  If they differ, the UI shows "This repository has changed since it was last indexed" with a
  re-index action, and AI responses carry a `freshness.stale` flag. Stale analysis is never presented
  silently.
- A `push` webhook to the indexed branch queues an `incremental_sync` job that re-embeds only the
  added/modified files and deletes vectors + graph rows for removed ones. Chunk identity is
  `(repository, file, startLine, symbol)` — deliberately excluding the commit SHA — so replacing one
  file's vectors never orphans the rest.
- A full index tags every point with an `indexRunId` and deletes points from previous generations
  afterwards, so dropped files and shifted chunk boundaries cannot leave stale vectors behind.
- Deliveries are recorded in `WebhookDelivery` with a unique index on `deliveryId`; a redelivery
  returns `{ duplicate: true }` without doing the work twice. Records expire after 14 days.

## Complete user workflows

**Scenario 1 — your own repository.** Sign in → Dashboard → paste the URL (or pick it from
Repositories) → **Index repository** (live counters) → Overview shows languages, entry points and
detected routes → ask *"Where is payment processing?"* and get an answer citing real files → click a
citation to open it in Monaco → run **Impact** on `processPayment` to see callers, routes and missing
tests → ask for *"validation for negative payment amounts"* → review the diff → **Accept** → branch
`codeweave/payment-validation` → commit → pull request. `main` is untouched.

**Scenario 2 — someone else's public repository.** Paste `https://github.com/amit/chat-app`. CodeWeave
shows **Read only**; Analyze, Ask AI and Impact all work. Generating a change is allowed, and
accepting it forks the repository under your account, branches, commits and opens
`rahul:codeweave/... → amit:main`.

**Scenario 3 — private repository without access.** "You don't have access to this repository. If it
is private, make sure your GitHub account can see it and that CodeWeave is installed on it." No
metadata beyond that is exposed.

**Scenario 4 — private repository with access.** Identical to scenario 1, gated on the app being
installed on the owning account; permissions come from GitHub, so an org that grants you read-only
gets the fork flow automatically.

---

## Deploying to Render

The repository includes `render.yaml`, so **New → Blueprint** picks up both services. Manual setup is
equally simple:

### 1. Backend (Web Service)

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |

Environment: every backend variable from the table above. Notes:

- `NODE_ENV=production` (enables secure, `sameSite=none` cookies — required for a cross-site SPA).
- `CLIENT_URL=https://<your-frontend>.onrender.com`, `SERVER_URL=https://<your-api>.onrender.com`.
- `GITHUB_PRIVATE_KEY` = the PEM with literal `\n`; leave `GITHUB_PRIVATE_KEY_PATH` empty.
- `GITHUB_CALLBACK_URL=https://<your-api>.onrender.com/api/auth/github/callback` — add the same URL
  to the GitHub App.
- Keep `WORKER_ENABLED=true` on the free plan; the API process drains the job queue itself.
- Consider `MAX_FILES=400`, `INDEX_CONCURRENCY=4`, `EMBEDDING_BATCH_SIZE=8` on the 512 MB free plan.
- Do **not** set `PORT`; Render injects it.

### 2. Frontend (Static Site)

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |
| Rewrite rule | `/*` → `/index.html` (SPA routing) |

Environment: `VITE_API_URL=https://<your-api>.onrender.com` (baked in at build time — redeploy after
changing it).

### 3. Point GitHub at production

Update the GitHub App: callback URL, webhook URL (`https://<your-api>.onrender.com/api/github/webhook`),
and keep the webhook secret identical to `GITHUB_WEBHOOK_SECRET`. Then verify:

```
GET https://<your-api>.onrender.com/api/health?deep=true   → status "ok" with all five services
```

**Free-plan caveats.** The API sleeps after ~15 minutes idle: the first request wakes it (~30 s) and
the embedding model reloads on the next index. Long indexing runs continue in-process, so keep
`MAX_FILES` modest. Render's free tier has no persistent disk, so the model cache is re-downloaded
after each deploy — `npm run warm:embeddings` is not needed, the first index warms it.
---

## Testing

```bash
cd backend && npm test
```

124 tests, 8 suites — chosen for the logic that is genuinely easy to get wrong:

| Suite | Covers |
| --- | --- |
| `repoIdentity.test.js` | URL/`owner/repo` parsing (https, SSH, `/tree/branch`, `.git`), host rejection, path traversal, NUL bytes, `.git` internals, git-illegal branch names |
| `fileFilter.test.js` | Ignored directories, binaries, lock files, generated output, size/empty limits, dotfile handling, language detection, test-path detection, indexing priority under a file cap |
| `ast.test.js` | Imports/exports (ESM + CommonJS), functions, classes, methods, hooks, components, Express routes, call attribution to the enclosing symbol, HOF-wrapped handlers, Mongoose statics, syntax-error recovery, TypeScript parsing, import resolution incl. `@/` alias and index files |
| `chunkerGraph.test.js` | Symbol-aware chunk boundaries and metadata, oversize splitting, prose chunking, test marking; import/call/defines/tests/routes edges, confidence levels, no invented edges, noise filtering, incremental resolution |
| `patchValidator.test.js` | Line-edit application, overlap/inversion/range rejection, diff stats, unknown-path and traversal refusal, truncation guard, no-op detection, base-changed detection, branch/commit/PR text generation |
| `permissions.test.js` | Permission normalisation, ownership never implying write, archived repositories, read-only UI contract, fork eligibility, GitHub error mapping (401/403 rate limit/404 by resource/422 variants/5xx), secret scrubbing in errors |
| `aiSafety.test.js` | Prompt-injection contract in every system prompt, untrusted-content envelope, JSON extraction/repair, schema rejection of malformed AI output, identifier extraction, token encryption round-trip + tamper detection, log scrubbing |
| `api.test.js` | Response envelopes, 401 on protected routes, CSRF rejection then acceptance, validation, webhook signature rejection (missing + invalid), CORS allow/deny, security headers, httpOnly session vs readable CSRF cookie |

Live verification (real services, no mocks): `scripts/checkServices.js`, `scripts/e2eVerify.js`
(22 checks), `scripts/webhookSmoke.js` (11 checks).

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Server exits with "Missing required configuration" | A required env var is empty. The log lists exactly which. |
| `check:services` fails on Groq with a model warning | Your key cannot use the configured model. The script prints the available list — set `GROQ_MODEL` to one of them. |
| "CodeWeave is pacing AI requests…" | Free-tier 8k tokens/minute. Wait ~30 s, or raise `GROQ_TPM_LIMIT` after upgrading Groq. |
| `413 Request too large` from Groq | `GROQ_TPM_LIMIT` is set higher than your plan allows. Lower it. |
| "GitHub API rate limit reached" | Unauthenticated public reads are 60/hour. Install the app on the repository (or sign in) for 5000/hour. |
| "You don't have access to this repository" on a private repo | Install the CodeWeave app on the owning account and include that repository in the selection. |
| Login redirects back to `/login?error=…` | Callback URL mismatch. `GITHUB_CALLBACK_URL` must equal the App's callback URL exactly. |
| Session lost on every request in production | `NODE_ENV` must be `production` (secure + `sameSite=none` cookies) and both services must be HTTPS. |
| CORS error in the browser | `CLIENT_URL` must be the exact frontend origin, no trailing slash. Add extras via `EXTRA_ORIGINS`. |
| Webhook deliveries show 403 in GitHub | `GITHUB_WEBHOOK_SECRET` differs from the App's secret, or a proxy rewrote the body. |
| Indexing stays "queued" | `WORKER_ENABLED=false` with no worker service running. |
| Qdrant boot error about vector size | The collection exists with a different dimension. Use a new `QDRANT_COLLECTION` or delete the old one. |
| First index is slow | The embedding model downloads once (~25 MB). Run `npm run warm:embeddings`. |
| "The AI could not produce valid structured output" | The model returned unusable JSON twice. Retry, or narrow the instruction. |
| "CodeWeave could not safely apply this change" | Patch validation refused it (stale base, truncated output, path outside context). Re-generate. |

## Known limitations

- **Call-graph resolution is heuristic** for dynamic dispatch, re-exported barrels and
  runtime-constructed calls. Unresolved calls are stored with low confidence and shown as such
  rather than presented as certain.
- **Non-JS languages** use regex symbol extraction, so their chunk boundaries and symbol lists are
  good but their call graphs are not built (imports are).
- **Large repositories** are capped by `MAX_FILES`/`MAX_TOTAL_CHUNKS`; the UI reports a *partial*
  index and says so in answers. Very large monorepos need those limits raised and a paid Groq tier.
- **Free-tier Groq** (8k tokens/minute) is the practical ceiling on context size. Prompts adapt, but
  a big multi-file refactor needs a higher limit.
- **Cross-file refactors** are intentionally conservative: at most four files per change, no renames
  across the repository.
- **Reviews read up to 12 changed files** with budgeted patches; enormous PRs are summarised, not
  read line by line.
- **Vector search is per repository by design** — cross-repository search is not exposed.
- **Monaco is read-only** in CodeWeave; editing happens through AI changes and pull requests.

## Future improvements

Streaming token-by-token chat responses; symbol-level (not directory-level) architecture graph with
zoom; multi-file refactors with a plan step; inline PR review comments anchored to diff positions;
scheduled re-indexing; Redis-backed queue for horizontal scaling; caching embeddings by content hash
across repositories; tree-sitter for real call graphs in Python/Java/Go.

## Screenshots

_Add screenshots here after your first run:_

| View | File |
| --- | --- |
| Landing page | `docs/screenshots/landing.png` |
| Dashboard | `docs/screenshots/dashboard.png` |
| Repository workspace (files + AI) | `docs/screenshots/workspace.png` |
| Impact analysis | `docs/screenshots/impact.png` |
| AI change diff + apply dialog | `docs/screenshots/change.png` |
| AI pull request review | `docs/screenshots/review.png` |
| Architecture graph | `docs/screenshots/architecture.png` |

## License

MIT — see `LICENSE`.








