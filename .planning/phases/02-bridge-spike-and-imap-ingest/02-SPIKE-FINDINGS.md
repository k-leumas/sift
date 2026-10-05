# Phase 2 Spike Findings: Proton Bridge against the owner's mailbox

Status: in progress

## Method

- **Bridge:** Proton Bridge v3.27.0, built from source at commit `04e46eb4fbc1c7ef4425a920bfc352050da0606b` (`bridge/Dockerfile` ARGs `BRIDGE_VERSION` and `BRIDGE_COMMIT`), image `sift-bridge:local`, keychain initialised with `docker compose run --rm --no-deps -T bridge-init keychain-init`.
- **Probe:** `docker compose run --rm --no-deps -T worker sift bridge probe <slug> [--label-test] [--uid <n>] [--wait-new-seconds <n>] [--compare <file|->] [--sample <n>] [--scan-limit <n>]` (plan 02-11), run from the main repository checkout. Each run prints one ProbeReport JSON, saved to the git-ignored `data/spike/` directory.
- **Run date:** 2026-10-05 (images built and keychain initialised; owner login pending).
- **Data rule:** this document holds aggregates only: counts, booleans, capability atoms, UID and UIDVALIDITY numbers and durations. No subjects, senders, recipients, email addresses, label names, raw Message-IDs or message bodies. Raw probe reports never leave `data/spike/`.
