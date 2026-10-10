# Phase 3: User Setup Required

**Generated:** 2026-10-10
**Phase:** 03-tiered-classification-with-traces
**Status:** Incomplete

Classification and the manual live baseline need the local model. Claude automated everything it could. These items need the owner's own machine.

## Environment Variables

None. Sift reads the Ollama address from `models.url` and the model name from `models.llm` in `config/config.yaml`.

## Account Setup

None. Ollama runs locally and needs no account.

## Dashboard Configuration

- [ ] **Install Ollama natively on the host and pull the configured model**
  - Location: host terminal (README: Mac mini vs mini PC)
  - Run: `ollama pull qwen3:1.7b`
  - Expected: the last line of the output is `success`
  - Notes: on a Linux mini PC, Ollama must accept connections from the Docker network at `host.docker.internal:11434`. If it does not, `docker compose run --rm setup sift mailbox list` shows `error: Ollama unreachable at http://host.docker.internal:11434 (...)`.

- [ ] **Create each mailbox's rules file**
  - Run, once per slug: `mkdir -p data/mailboxes/<slug> && cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml`, then edit it
  - Check: `docker compose run --rm --no-deps worker sift config check`
  - Expected: `Config OK: <n> mailboxes (<slugs>); password env vars present; rules files valid`

## Verification

Live baseline, on synthetic data only, at phase verification (AI-SPEC section 5: E4 live, E11 live, E12 baseline). Run it from the repository root after `pnpm install`:

```bash
node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b
```

Expected results:
- A Markdown table with the header `| fixture | category | confidence | attempts | thinking null | total_ms | flip | model digest |`
- Exactly 10 data rows, `yes` in every "thinking null" cell, and the same model digest in every row
- A last line `flips: <n>`. A non-zero count is the accepted Phase 3 residual (AI-SPEC section 6), not a failure. Paste the whole output into the phase VERIFICATION under "Live baseline (synthetic data)", and note the categories of the four action-mail pairs (bank notice, payment failure, interview, personal reply) for E12.

---

**Once all items complete:** Mark status as "Complete" at top of file.
