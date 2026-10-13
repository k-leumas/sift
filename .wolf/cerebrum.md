# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-10-11

## User Preferences
- [2026-10-08] Short first-sync backfill: `ingest.initial_backfill_days` default 3 (D-20). Prefers fail-closed, append-only, no automatic reclassification; picked every recommended Phase 3 option.
- [2026-10-07] Tests for root scripts go in root `test/<name>.test.ts`, not apps/worker/test; existing tests stay put. Move committed files in a follow-up `git mv` commit, never a history rewrite.
- [2026-10-07] Commands for the user to paste must be single-line (e.g. `psql -Atc "..."`), never heredocs.
- [2026-10-05] UAT checkpoints: give copy-paste commands plus the exact expected output.
- [2026-10-05] User answers "option N with/as long as …" or writes their own design. Record every refinement verbatim as its own decision. State security rules in their precise form. Strong preferences: fail closed, secrets never in terminal/scrollback, no misleading errors on routine starts, rare events logged with counts.
- [2026-10-05] Privacy: IMAP is the source of truth. Bodies live only in a short-lived cache (classified + 7 d). Traces store the prompt recipe, not raw prompts.
- [2026-10-05] When a durable key format changes, migrate or dual-read old keys and prefer a CHECK that makes the old format unstorable. Tuning values are named constants, and computed values such as watermarks get logged.
- [2026-10-04] `.claude/`, `.wolf/`, `.gsd/`, `.planning/`, `CLAUDE.md` are code: commit them like source, after a secrets scan.
- (2026-10-12) Owner treats README discoverability as a real defect: the quick start must be findable from the top of the README, not only present. When pointing at README content, give line numbers.

## Key Learnings
- **Verifier scratch tests:** a vitest file outside the repo runs with a scratch config that sets `root` to the repo, `process.chdir(ROOT)`, loads the dev env file, uses the absolute global-setup path and imports repo modules by absolute path (they resolve to the same modules as `@sift/*`). Nothing is written to the repo, and freshDatabase gives an isolated DB.
- **Project:** sift is self-hosted email triage: plain-English rules, a tiny classifier and a small local LLM. It supports Proton Mail via Bridge only.
- **Shell:** use Node 26.10.0 via `PATH=$HOME/.nvm/versions/node/v26.10.0/bin:$HOME/Library/pnpm:$PATH` and run `unfunction pnpm` first. zsh: `cp`/`rm` are interactive aliases (use `command cp -f`/`command rm -f`), `g` is an alias, `$VAR:path` applies modifiers (write `"${VAR}:path"`), `echo` interprets backslashes (use `printf '%s\n'`). Exec latency is about 1 s per spawn.
- **Guard hooks:** any Bash text that names `.env.<suffix>` is blocked, so put such checks in test code. GSD worktree agents reject commands that read as git. Re-run `dispatch-isolation --force-isolation none` before every executor dispatch, because the sentinel lasts 10 min.
- **Gates:** lefthook runs biome and commitlint (lines ≤100, subject must not start upper-case: put finding ids last). Never use `--no-verify`. `pnpm -s` is broken, so run `pnpm lint`/`pnpm typecheck` without it. Biome rewrites `\uXXXX` to literal characters and lints `.vitest/*.json`.
- **Runtime:** the worker runs .ts via type stripping, and workspace packages export `./src/*.ts`. The CLI table is in apps/worker/src/command.ts. @sift/worker has no `pg` dependency, and apps cannot import drizzle-orm.
- **Tests:** `pnpm test` needs Docker (sift-db-1, 127.0.0.1:5432) plus `scripts/test-imap.sh up` (Dovecot :31143). Re-run bridge-probe/compose-smoke/imap-* timeouts with `--no-file-parallelism`. Pure tests: `SIFT_TEST_ADMIN_URL= pnpm exec vitest run <files>`. DB tests use freshDatabase() and seed helpers in packages/db/test/support. Hold lockAppRole() around migrate. Never grant roles to sift_app. Never run `vitest --root /`.
- **TDD RED evidence:** use `--reporter=default --reporter=junit --outputFile.junit=<in-repo .vitest/ file>` with `-t`, targetTest `<describe> > <it>`, and no targetFile. For tracer-built code, overlay the plan-base implementation (`git show`) plus new export names only, then restore from a scratch copy. Mutations must change behaviour. Move the record out of .vitest/ afterwards.
- **DB:** every scoped table needs FORCE RLS, `mailbox_id` FK, one standard policy, grants and a set_updated_at trigger (catalog check), or a CATALOG_ALLOWLIST entry. App code goes through withMailbox scopes, never raw SQL. CHECKs pass on NULL, and they fire in constraint-name order. Bind lists with `sql.param(array)`. Use `codedCause` for logged or stored errors (never Drizzle's "Failed query" text, never JSON.parse messages). Postgres rejects NUL, so stripNul. `pnpm db:generate --name=x` handles changes; custom migrations need `--> statement-breakpoint`.
- **Docs tests:** apps/worker/test/user-facing-text.test.ts pins README/CONTRIBUTING commands, step order (first indexOf) and owner lines against the code that prints them. README Technical settings YAML must parse via loadConfig. Number pins need a digit boundary.
- **Zod 4.6:** string min/max counts code points. `z.enum` reports a missing value as invalid_value. A `.default()` key is required in z.output, so hand-built SiftConfig/MailboxConfig literals must include it (`pnpm typecheck` finds them).
- **Bridge v3.27.0:** no CONDSTORE/QRESYNC/ENABLE; COPY needs SELECT; `X-Pm-Internal-Id` is stable. Initial sync is newest-first and slow, so uidNext is not a new-mail signal: use `sift bridge probe <slug> --scan-limit 0 --sample 200` filtered by INTERNALDATE. A UIDVALIDITY resync stores every unseen UID as historical.
- **TLS (D-80):** checkServerIdentity runs only after chain verification. Capture the cert credential-free (capture.ts), then log in with `ca: [captured]` plus an SPKI check. Hash SPKI via X509Certificate.publicKey export.
- **ImapFlow 2.1.0:** sends ID before STARTTLS (connect.ts wraps run). search() returns false on failure. download maxBytes counts decoded bytes. `exec()` callers must call `next()`.
- **Classification (P3):** decide() is the only decision assembler and recordDecision the only write path. run.ts classifies in 5-message chunks under withIngestLock. EXPECTED_PROMPT_HASH changes deliberately. The fake Ollama is test/support/fake-ollama.ts, and tests must never hit the real port (use 127.0.0.1:9). Adding a review reason means REVIEW_REASONS, the LlmVerdict union, the scoped.ts CHECK and `pnpm db:generate`.
- **Compose 2.2.3:** a missing env_file or external volume fails every command. Single-file bind mounts: rename gives EBUSY, so write in place. `docker compose run` needs `-T` in the agent shell. Local smoke: `SMOKE_ALLOW_VOLUME_REMOVAL=yes COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down`.
- **GSD:** gsd-tools is at ~/.claude/gsd-core/bin/gsd-tools.cjs; wrap it as `gsdq() { node ... "$@"; }`. evaluation-scope under-scopes, so use `git diff --name-only <start>..HEAD`. Verifier overrides go only in VERIFICATION.md frontmatter `overrides:`. Run worktree-blind owner Docker steps from the main checkout.
- **Write/Edit tools** decode backslash-u escapes. Check new files with `LC_ALL=C grep -c -P '[^\x09\x0A\x20-\x7E]'`.
- **tui-llm** (sibling repo, not this tree): `src/ui/CandidateSelect.tsx` and `tests/modal-layout.test.ts` live in `/Users/samuel/dev/tui-llm`. A biome `suppressions/unused` on `useExhaustiveDependencies` means the dep list is already complete; delete the ignore comment.
- (2026-10-12) Owner-run commands (e.g. llm-baseline.ts) must be run from the sift repo root; the owner also has /Users/samuel/dev/public_gsd-2 checked out. Local main can be far ahead of origin (168 commits on 2026-10-12), so the GitHub README may lack recent docs.
- (2026-10-12) README has a second numbered bold list (Contributing, ~line 704), so count quick-start steps inside the '### Quick start'..'### Managing mailboxes' slice only. Branch uat/03-verify (worktree .claude/worktrees/uat-03-verify) holds its own unmerged 03-23 plan and a different G-03-8; main's 03-23/03-24 (planned 2026-10-12) collide by number if it is ever merged.
- (2026-10-12) README quick-start steps (03-24, G-03-8) are `<n>. **Short imperative.**` (bold only, <=60 chars, ends with a period), then the command block, then details, indented 3 spaces (steps 1-9) or 4 (10+). A new or renumbered step must keep that shape, the intro's "12 numbered steps" count and the step-6/8/9/12 leads (cross references); notes after the last step go under `#### After the first start`.
- (2026-10-12) PostgreSQL jsonb rejects unpaired UTF-16 surrogates as well as NUL (JSON.stringify writes them as an escape; text columns are fine because node-postgres encodes U+FFFD). Mail text is already safe (ingest/message.ts clean() = stripNul + toWellFormed); model reasons and rules.yaml text needed isWellFormed checks (gap plans 03-25 WR-04, 03-26 WR-05). In plans and tests, name such code points as U+D800 in prose and build them with String.fromCharCode, never as escapes. 03-25 added the decision backstop: recordDecision runs wellFormed(stripNul(...)) over the parsed spans (wellFormed in packages/db/src/ingest.ts, internal); anything else bound for jsonb needs the same.
- (2026-10-12) llm-baseline.ts runs 10 Ollama chats (~4 min on qwen3:1.7b); it prints a ready line and one progress line per email on stderr, and the table on stdout at the end (03-23, G-03-2); live baseline 2026-10-12: flips 3, clean personal reply filed as Reading (E12 candidate).
- (2026-10-12) `release.yml` (5 min timeout) tags and writes the GitHub Release notes. It does not build or push images. `bridge-image.yml` builds Bridge only for smoke and allows 45 minutes. Compose defaults are `SIFT_IMAGE=sift:local` and `SIFT_BRIDGE_IMAGE=sift-bridge:local`, both with a `build:` block, so `up` compiles from the checkout. Postgres is the public `pgvector/pgvector:0.8.7-pg18-trixie` image. The worker image is Node running TypeScript (`/usr/local/bin/sift` execs `cli.ts`); root `package.json` is `private`. Host files the image does not contain: `compose.yaml`, `db/bootstrap.sql`, config, `.env`, `.env.mailboxes`.
- (2026-10-12) rules.yaml text checks (packages/core/src/rules/schema.ts oneLine): line break, then control character, then unpaired surrogate (isWellFormed, 03-26 WR-05), one issue per value. from/domain/phrase entries use separate non-aborting refines (noControl, then noUnpairedSurrogate), so an entry holding both reports two issues at the same path.

## Do-Not-Repeat
- [2026-10-11] Use `ensure_ascii=False` (indent=2, trailing newline) when rewriting .wolf/buglog.json with Python. Confirm the diff is additions only.
- [2026-10-11] An apostrophe in a single-quoted it() title breaks the vitest transform (bug-247).
- [2026-10-11] `gsd state.add-decision --summary-file` rejects paths outside the repo; pass `--summary "..."` (bug-273).
- [2026-10-10] Mutation restores with `git checkout --` discard uncommitted edits. Restore from a scratch copy (bug-233).
- [2026-10-10] Never `source` GSD reference markdown in Bash (bug-228).
- [2026-10-10] Executors share the scratchpad, so use per-plan subdirectories and never touch shared helpers.
- [2026-10-10] A schema-change task must update seed.ts and every scoped insert in the same task.
- [2026-10-10] A union-key `withMailbox(...update)` needs an explicit generic (bug-210).
- [2026-10-07] Scripted slice edits need unique anchors plus `assert a < b`, or use the Edit tool (bug-194).
- [2026-10-07] Before worktree cleanup, revert `.wolf/anatomy.md` if it only holds worktree-path noise (bug-188).
- [2026-10-07] Never `docker logs x | grep -q` under pipefail; capture into a variable first (bug-139).
- [2026-10-06] Two describes seeding the same slug in one freshDatabase clash; use distinct slugs.
- [2026-10-05] Fake timers: a setTimeout(0) created inside a callback fires 1 ms later.
- [2026-10-04] Commit with an explicit pathspec (`git commit -- <files>`), never `gsd query commit`, so pre-staged files stay out. If a commit fails, re-check `git diff --cached`.
- [2026-10-04] Negative acceptance greps scan comments too, so never write forbidden literals in comments.
- [2026-10-04] Run `state.advance-plan` exactly once and read its JSON.
- [2026-10-04] A test net.Server socket needs `socket.resume()` to see FIN.
- [2026-10-03] zsh does not word-split `$FILES`; use arrays.
- [2026-10-12] Do not write UAT checkpoint text that describes behaviour superseded by a later plan (03-22 "hold-back until restart" was replaced by 03-20 llm_error review). Check the latest SUMMARY/README before phrasing a test.
- [2026-10-12] In zsh, pass file lists to git as an array F=(a b) not a string (bug log). Never put raw \u2028/\u2029 in a regex via the Write tool; check with grep after writing.
- [2026-10-12] `vitest run test/` matches apps/*/test too and needs DB/IMAP services; name test files explicitly.

## Decision Log
- 2026-10-13 (03 UAT 135-136): owner kept WR-06 (max 2 alone-failing messages per pass, a third is an outage) and WR-07 (3 failed passes + healthy canary -> review `llm_error`) as designed; no canary-instead-of-outage or minimum-span change.
- 2026-10-11 (03-19): owner chose option-review. A message Ollama fails on alone in 3 passes (healthy re-probe + canary) ends as review `llm_error` (migration 0011, one-way).
- 2026-10-10 (plan-phase 3): `decided_by` worker|rerun with one worker decision per message. rule_set is append-only. prompt_version is unscoped (advisory lock 815309003). The ingest lock is taken per 5-message chunk. needs_attention mailboxes are not classified. Category names are ASCII.
- 2026-10-08: evals use Vitest + the fake Ollama (E1–E11 as CI gates); live-model quality is a manual baseline. No external trace tool (SEC-02); decision.spans is the trace store.
- 2026-10-07: Proton Bridge only for now; the README must say so. Owners must keep the host clock NTP-synced.
- 2026-10-05 D-80: never send credentials or data over an unverified connection. Keep capture.ts and disable verification nowhere else.
- 2026-10-05 D-79/D-81: one-shot `bridge-init` service (profile tools) alone mounts `.env.mailboxes`, plus a pre-created 0600 `.env.mailboxes.bak`.
- 2026-10-04: the worker exits 75 after 3 missed heartbeats, with `restart: unless-stopped` and no autoheal sidecar. It refuses privileged roles or any role membership. compose-smoke `--down` refuses outside CI without SMOKE_ALLOW_VOLUME_REMOVAL=yes.
- (2026-10-12) Releases moved from local-only to CI: .github/workflows/release.yml runs after a green ci run on main (owner choice over every push); a real local pnpm release refuses without SIFT_RELEASE_CI=1, --dry-run stays. Reverses the quick-261007-2ke "releases run only locally" decision.
- (2026-10-12) CHANGELOG highlights are written by Claude API (claude-opus-5-5, fallbacks default) from commit messages only, via the ANTHROPIC_API_KEY repo secret; owner chose this over local Ollama. Falls back to linked commit lists.
- (2026-10-12) Owner wants a release a person can install and run. Current release.yml publishes notes only (`gh release create` with no files). Images stay local (`sift:local`, `sift-bridge:local`). The installable unit is those two images on GHCR plus a compose bundle; a single binary still needs Postgres, Bridge, and Ollama.

