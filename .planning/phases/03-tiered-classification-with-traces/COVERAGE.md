# API Coverage — Ollama REST API (local server at models.url)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Integration: direct `fetch` from the worker (03-AI-SPEC §2), plans 03-07 (client, preflight), 03-08 (pass), 03-13 (baseline runner).

| capability | decision | reason |
|---|---|---|
| chat (`POST /api/chat`, `stream: false`) | INTEGRATE | |
| structured output (`format` = JSON schema with the category enum) | INTEGRATE | |
| thinking control (`think: false`, thinking field recorded) | INTEGRATE | |
| request options (`temperature`, `seed`, `num_predict`, `num_ctx`) | INTEGRATE | |
| truncation control (`truncate: false`, `shift: false`, context-length 400) | INTEGRATE | |
| model residency (`keep_alive`) | INTEGRATE | |
| server version (`GET /api/version`) | INTEGRATE | |
| local model list, digest, remote check (`GET /api/tags`) | INTEGRATE | |
| model info (`POST /api/show`, capabilities) | INTEGRATE | |
| error responses (`{"error": ...}` with 400/404/429/500/503) | INTEGRATE | |
| response metrics (durations, prompt_eval_count, eval_count) | INTEGRATE | |
| streaming responses | OPT-OUT | not needed: one validated answer per call; mid-stream errors under HTTP 200 would blur the D-16 / D-24 split (AI-SPEC §4b) |
| completion (`POST /api/generate`) | OPT-OUT | not needed: `/api/chat` covers the single-shot call and keeps the trusted system and untrusted user parts as separate roles (D-21) |
| tools / function calling | OPT-OUT | explicitly out of scope: CLS-05 forbids any action channel for model output |
| images / multimodal input | OPT-OUT | explicitly out of scope: attachment content is never read, only attachment names (P2 D-08) |
| embeddings (`POST /api/embed`, legacy `/api/embeddings`) | OPT-OUT | not needed yet: the embedding classifier tier arrives in M2 (the Phase 3 trace marks it skipped, TRC-06) |
| running models (`GET /api/ps`) | OPT-OUT | not needed: the preflight uses tags and show; cold loads show up as load_duration in the span |
| pull model (`POST /api/pull`) | OPT-OUT | explicitly out of scope: the owner pulls models (README); Sift never downloads anything (SEC-02) |
| push, create, copy, delete model and blob endpoints | OPT-OUT | explicitly out of scope: model management belongs to the owner; Sift only reads model metadata |
| token log-probabilities | OPT-OUT | not needed yet: logprob confidence is a deferred idea for M4 evals (03-CONTEXT deferred) |
| OpenAI-compatible endpoints (`/v1/*`) | OPT-OUT | not needed yet: a later provider plugs in behind the `LlmClient` interface (AI-SPEC §2) |
| conversation context / chat history | OPT-OUT | not needed: every call is stateless; all state lives in Postgres (AI-SPEC §4 State Management) |
| cloud models and hosted web search | OPT-OUT | explicitly out of scope: mail must stay on the machine (SEC-02); the preflight refuses remote models |
