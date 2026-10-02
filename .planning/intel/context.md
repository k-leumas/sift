# Context (from DOCs)

Single DOC source: /Users/samuel/dev/sift/README.md (type DOC, manifest override, confidence high). Entries are condensed topic extracts; where the README restates an ADR, the ADR in decisions.md governs. Items marked (README-only) are not backed by any ADR.

## Product positioning
- source: /Users/samuel/dev/sift/README.md
- Self-hosted email triage on a small always-on home machine (mini PC or Mac mini). Reads mailboxes over IMAP, sorts each message into owner-defined categories, applies them as labels in the mail client. Rules in plain English, a tiny classifier trained on the owner's corrections, a small local LLM only when needed; when nothing is confident, Sift asks the owner.
- One owner, many mailboxes, each with its own rules and trained classifier. Email never leaves the network; no cloud model, no telemetry, no accounts.
- Status: pre-alpha, in design; README describes the target.

## Pipeline overview
- source: /Users/samuel/dev/sift/README.md
- Up to three tiers per message, cheapest first (Tier 0 exact rules, Tier 1 embedding classifier, Tier 2 small LLM), then label application, validation, and a review queue when unsure. Governed by ADR-0002.

## Tier 0 / Tier 1 / Tier 2 details (README-only specifics)
- source: /Users/samuel/dev/sift/README.md
- Tier 1 embeddings by `nomic-embed-text` by default; retrains in the background after every correction (milliseconds on a few thousand emails); category handled by Tier 1 only once it has `min_examples_per_category` (default 15) confirmed examples, otherwise goes to Tier 2; explanation shows the past emails it resembled.
- Tier 2 via Ollama, 1B-class instruct model by default; prompt has three separated parts (categories and judgment rules, trusted; similar past corrections retrieved by embedding, trusted; the email, untrusted and fenced off); output must be a category, a confidence and a one-sentence reason via JSON-schema structured output; malformed output retried once then sent to review.
- Spot checks: `spot_check_rate` default 5% of Tier 1 decisions also sent to Tier 2; disagreement sends the message to review. Works only because Tier 1 and Tier 2 learn from different sources.
- Quick confirm: batch of recent Tier 2 decisions (batch_size 20), at most once a day by default (`quick_confirm.max_per_day`); "a nudge, not a queue you have to clear"; labels already applied in the mail client unchanged unless the owner fixes one.
- Review queue: single queue across all mailboxes with one-key labeling; answers become Tier 1 training data and Tier 2 retrieval data for that mailbox.

## Learning from the mail app
- source: /Users/samuel/dev/sift/README.md
- Restates ADR-0003 detection (about once a minute, Message-ID matching, CONDSTORE/QRESYNC where supported), the interpretation table, and correction routing. README extra: the Tier 0 correction prompt wording ("You moved this out of Reading, but your newsletter rule put it there. Edit the rule?") and the quick-confirm prompt for a removal ("You removed Noise from this. Where should it go?").

## Decision traces
- source: /Users/samuel/dev/sift/README.md
- Restates ADR-0003. README extras: example trace layout (Tier 0 12 checked 0 matched; Tier 1 classifier v14 scores and 0.85 threshold escalation; Tier 2 qwen3:1.7b prompt v3, 6 examples, confidence 0.88; action copied to Labels/Job search); replay of an old decision against today's rules, classifier and model; traces use the same span structure as LLM observability tools so could be exported later.

## Configuring Sift in plain English (README-only)
- source: /Users/samuel/dev/sift/README.md
- Each mailbox has a `rules.md` (Categories section, Rules section) editable on the Rules page of the web UI; optional `shared-rules.md` applies to all mailboxes. Layout: `data/shared-rules.md`, `data/mailboxes/<slug>/rules.md`.
- On save, Sift interprets each rule and shows what it understood before anything changes; each rule runs as Exact (Tier 0) or Judgment (Tiers 1-2). Owner confirms or fixes each interpretation; the confirmed version is saved to the mailbox's generated `rules.lock.yaml` (reviewed in the UI, never hand-edited), with fields `source`, `kind`, `match`, `label`, `confirmed`.
- Preview before apply: a change is replayed against the mailbox's recent mail (example: "would move 14 of your last 200 emails"), surfaces earlier confirmed labels that now conflict ([Keep them] [Relabel them]), with [Review all] [Apply] [Cancel]; Tier 1 retrains as soon as conflicts are resolved. (ADR-0002 also notes the rule-change preview must surface such conflicts.)

## Technical settings (config.yaml, README-only)
- source: /Users/samuel/dev/sift/README.md
- Passwords never stored in config; each mailbox points at an environment variable (`password_env`), consistent with ADR-0001.
- Example keys: `mailboxes[]` (slug, imap host/port/username/password_env/folder, `labels.apply_as: proton_labels`); `models` (provider ollama or any OpenAI-compatible endpoint, url `http://host.docker.internal:11434`, embeddings `nomic-embed-text`, llm `qwen3:1.7b`); `tiers.tier1` (confidence_threshold 0.85, min_examples_per_category 15, spot_check_rate 0.05); `tiers.tier2` (confidence_threshold 0.75, examples_per_prompt 6); `quick_confirm` (batch_size 20, max_per_day 1); `relabel_sync` (enabled true, poll_interval_seconds 60).

## Data model
- source: /Users/samuel/dev/sift/README.md
- One owner, many mailboxes, no users table; mailbox is the isolation boundary. Tables and scoping as listed in README: `mailbox` (n/a), `message`, `label`, `decision`, `folder_sync`, `label_event`, `classifier` (all `mailbox_id`), `rule_set` (`mailbox_id` or shared), `prompt_version` (global), `eval_run` (`mailbox_id` or synthetic), `flag` (`mailbox_id`). `label` records whether a label was confirmed by the owner or applied by Sift and where confirmation came from (review queue, quick confirm, mail app).
- Note: README scoping of `rule_set`, `prompt_version` and `eval_run` differs from ADR-0001's "non-null mailbox_id" wording; see INFO entry in INGEST-CONFLICTS.md. ADR-0001 governs.
- Unified review queue filters via URL (`/review?mailbox=job-search`); reading across mailboxes is fine, learning across them is not.

## Security model (README-only)
- source: /Users/samuel/dev/sift/README.md
- Trusted: `rules.md`, `shared-rules.md`, `config.yaml`, the owner's labels. Untrusted: every byte of every email (subject, body, headers, attachment names).
- Email content sits in a fenced section of the Tier 2 prompt; Tiers 0 and 1 never interpret email as instructions. Every tier can only return one of the mailbox's categories; nothing can invent labels, call tools or emit actions.
- Limited actions: applies labels and (later) writes drafts; never sends, deletes or forwards mail. Suspected injection attempts flagged in the UI audit view. `evals/injection/` holds adversarial emails and CI fails if any changes a classification.
- Privacy: everything on owner hardware by default; pointing `models.url` at a hosted API sends email content to that provider and the UI warns about it; no telemetry, analytics or crash reporting.

## Evals
- source: /Users/samuel/dev/sift/README.md
- Synthetic inbox (a few hundred fictional emails with known labels) in `fixtures/synthetic-inbox/`, used for CI (every PR runs the full pipeline), model selection, prompt and rule change comparison on the Evals page, and the public demo. Each run reports accuracy and per-category confusion matrix, tier coverage and per-tier accuracy, Tier 1 learning curve, per-tier latency.
- Open experiment `learn-from-tier2` (`pnpm eval --experiment learn-from-tier2`) stays behind an experimental flag; consistent with ADR-0002. README says Tier 1 never trains on Tier 2 labels "unless you've approved them" (i.e. via quick confirm).
- Owner's labeled mail stays in the database as a private per-mailbox eval set, never committed; corrected Tier 2 mistakes are added automatically. Commands: `pnpm eval`, `pnpm eval --mailbox personal`, `pnpm eval --models qwen3:0.6b,qwen3:1.7b,gemma3:1b`, `pnpm eval --compare prompt:v3 prompt:v4`.

## Deployment and requirements (README-only)
- source: /Users/samuel/dev/sift/README.md
- Docker and Docker Compose; 8 GB RAM enough for default models; an IMAP account per mailbox (Proton Mail needs Proton Bridge on a paid plan, one Bridge instance can serve several addresses); Ollama.
- Mac mini (Apple Silicon): run Ollama natively (Docker on macOS can't use the GPU), containers reach it at `host.docker.internal:11434`; this is the default. Linux mini PC: everything in Docker using the `ollama` Compose profile.
- Planned quick start: copy `config.example.yaml` and `.env.example`, pull `nomic-embed-text` and `qwen3:1.7b`, `docker compose up -d` (or `--profile ollama`), one-time `docker compose run --rm bridge init`, add mailbox via `docker compose run --rm worker sift mailbox add personal`; UI at port 3000.
- Remote access: do not expose to the internet; use Tailscale or a similar private network (consistent with ADR-0001 network-level gating).

## Project structure and stack (README-only)
- source: /Users/samuel/dev/sift/README.md
- Layout: `apps/web` (React Router v7: review queue, rules editor, evals, audit log), `apps/worker` (per-mailbox IMAP ingest, tier pipeline, label actions), `packages/core` (rule interpreter, prompt builder, zod output schemas), `packages/classifier` (Tier 1), `packages/db` (Drizzle schema, migrations, RLS policies), `packages/evals`, `fixtures/synthetic-inbox/`, `evals/injection/`, `evals/isolation/`, `docs/adr/`, `data/`, `compose.yaml`, `config.example.yaml`, `.env.example`.
- Stack: TypeScript end to end (including Tier 1, no Python), React Router v7, Hono, Postgres + pgvector, Drizzle, Ollama, Docker Compose.

## Roadmap (milestones M1-M7)
- source: /Users/samuel/dev/sift/README.md
- All unchecked. M1 Classify: one mailbox, IMAP to hardcoded Tier 0 rules and Tier 2 LLM to Proton labels on a real inbox, no UI, decision traces from the first classification, mailbox-scoped schema with RLS from day one, plus a Proton Bridge spike (labels as folders, CONDSTORE/QRESYNC support, Message-ID reliability). M2 Learn: review queue with Why? traces, one-key labeling, Tier 1 with retrain on every correction, cold-start thresholds, spot checks, quick confirm, learning from mail-app relabels. M3 Plain-English rules: `rules.md`, interpretation step, `rules.lock.yaml`, rules editor, conflict handling for previously confirmed labels. M4 Evals: synthetic inbox, per-tier metrics, model comparison, change preview, learn-from-Tier-2 experiment. M5 Multiple mailboxes: manage in UI, per-mailbox rules and classifiers, `shared-rules.md`, unified review queue, isolation test suite. M6 Guardrails: injection suite, audit view, public demo on synthetic data. M7 Extras: draft replies to recruiters from `resume.yaml`, webhooks (for example n8n).
- Not planned: sending email, a hosted version, multiple users (mailbox model built so adding logins would not need a rewrite; see ADR-0001).

## Contributing and license
- source: /Users/samuel/dev/sift/README.md
- Rules: never commit real email (use synthetic inbox); changes to prompts, models or classification must include an eval run in the PR description; every new table holding mail-derived data gets a `mailbox_id` and an RLS policy and isolation tests must pass. Architecture-changing work probably needs an ADR. License: AGPL-3.0 (LICENSE file referenced, not part of the ingest set).
