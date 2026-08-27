# CodeWeave — build progress

Live checklist. Updated as work lands. `[x]` = implemented **and** verified by running it.

## Backend

- [x] **P1** Project setup — backend package.json, `.env` / `.env.example`, gitignore
- [x] **P2** Config layer — env validation, Mongo, Qdrant, Groq, GitHub App (PKCS#1→PKCS#8), logger with secret redaction
- [x] **P3** Service connectivity — `npm run check:services` passes for Mongo Atlas, Qdrant Cloud, Groq, GitHub App, embeddings
- [x] **P4** Mongoose models + indexes (User, Repository, Conversation, IndexJob, CodeChange, PullRequestReview, CodeFile, CodeSymbol, CodeEdge, WebhookDelivery)
- [x] **P5** GitHub service layer — OAuth (user authorization), token refresh, repositories, contents, writes (branch/commit/fork), pulls, error mapping, rate-limit handling
- [x] **P6** Embeddings — all-MiniLM-L6-v2 (384-dim) local ONNX provider + hosted HF provider, batching, dimension validation
- [x] **P7** Qdrant store — collection bootstrap, payload indexes, repository-scoped search, per-file delete, structural scroll
- [x] **P8** AST analysis — Babel extractor (imports/exports/functions/classes/methods/hooks/components/routes/calls), regex extractor for 12 other languages
- [x] **P9** Chunking — symbol-aware chunks with metadata, oversize splitting, prose/config blocks
- [x] **P10** Graph builder — import resolution, call resolution with confidence, defines/tests/routes edges
- [x] **P11** Indexing pipeline — tree → filter → fetch → parse → chunk → embed → Qdrant → graph → Mongo, real progress counters
- [x] **P12** Job queue + worker — atomic claim, heartbeat, stale recovery, in-process and standalone worker
- [x] **P13** RAG — hybrid retrieval (semantic + symbol + graph hop), grounded answers, citations, conversation persistence
- [x] **P14** Impact analysis — structural graph severity + semantic matches + Groq explanation
- [x] **P15** AI code modification — structured JSON output, patch validation, diff generation
- [x] **P16** Apply flow — permissions → fork if needed → branch → base re-verify → commit → PR
- [x] **P17** AI PR review — diff + file context + graph dependents + tests, typed findings with confidence
- [x] **P18** Repository overview — deterministic facts + narrative, cached per commit
- [x] **P19** Webhooks — signature verification, delivery dedupe, push→incremental sync, PR→AI review, installation events
- [x] **P20** Middleware — auth, CSRF, rate limits, validation, request logging, central error handler
- [x] **P21** REST API — auth, repositories, indexing (+SSE), AI, changes, GitHub writes, pulls, activity, health
- [x] **P22** Server boots; `/api/health?deep=true` reports all five services healthy
- [x] **P23** Automated tests (vitest) — 124 tests covering URL parsing, path safety, permissions, filtering, AST, chunking, graph, impact, patch validation, prompt injection, API contract
- [x] **P24** End-to-end verification against a real repository — `scripts/e2eVerify.js`: 22/22 checks (index → Qdrant/Mongo → scoping → RAG with citations → impact → validated patch)
- [x] **P24b** Webhook verification — `scripts/webhookSmoke.js`: 11/11 checks (signature, dedupe, push/PR/installation routing)
- [x] **P24c** Groq free-tier token governor (8k TPM) + budget-derived prompt sizing
- [x] **P24d** WRITE-path verification on a real repository — `scripts/verifyWriteFlow.js` on `ddan041/newdemo`: index → RAG → impact → validated patch → branch → commit → **PR #1** → AI review published to GitHub (17/18 checks; the one miss was a live bug, now fixed)
- [x] **P24f** Retrieval fallback for small repositories — when no chunk clears the similarity threshold the whole (small) index is used instead of refusing; the no-context reply now reports how many files/chunks are actually indexed
- [x] **P24e** Bugs found by live verification and fixed: empty-repo detection no longer trusts GitHub's lagging `size` field; AI schemas tolerate `null`; schema failures now actually retry instead of being misreported as upstream errors

## Frontend

- [x] **P25** Vite + React + Tailwind + shadcn-style UI kit, dark/light theme
- [x] **P26** App shell, routing, auth context, API client with CSRF + 401 handling
- [x] **P27** Landing + login pages
- [x] **P28** Dashboard — repositories, analyze-any-repo, activity feed
- [x] **P29** Repository workspace — file explorer, Monaco viewer, symbol search
- [x] **P30** AI assistant panel — streaming-style chat, clickable citations
- [x] **P31** Impact analysis view
- [x] **P32** Changes view — Monaco diff, accept/reject, branch/commit/PR forms, fork flow
- [x] **P33** Pull requests — list, detail, AI review rendering
- [x] **P34** Overview + architecture graph views
- [x] **P35** Indexing progress (SSE + polling), skeletons, empty/error states, toasts
- [x] **P36** Frontend production build passes

## Delivery

- [x] **P37** README (setup, GitHub App config, webhooks, architecture, deployment)
- [x] **P38** Render deployment config (`render.yaml`, build/start commands, env var list)
- [x] **P39** Final verification pass — 124 unit/API tests, 6/6 live services, 22/22 e2e, 11/11 webhook, both builds green
