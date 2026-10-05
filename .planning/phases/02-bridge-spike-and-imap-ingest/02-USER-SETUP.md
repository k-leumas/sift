# Phase 2: User Setup Required

**Generated:** 2026-10-05
**Phase:** 02-bridge-spike-and-imap-ingest
**Status:** Incomplete

Complete these items so the pinned Proton Bridge release keeps moving (D-31). Claude automated everything possible (renovate.json, the bridge-image CI workflow). These items need your access to GitHub.

## Environment Variables

None.

## Account Setup

None. Renovate runs as a GitHub App on your existing GitHub account.

## Dashboard Configuration

- [ ] **Install the Renovate GitHub App on k-leumas/sift** (from plan 02-15)
  - Location: https://github.com/apps/renovate -> Install -> Only select repositories -> `k-leumas/sift`
    (manage it later under GitHub -> Settings -> Integrations -> GitHub Apps)
  - Then: if Renovate opens a "Configure Renovate" onboarding PR, merge it. The repository already has `renovate.json`, so Renovate may skip onboarding and start directly.
  - Notes: `renovate.json` enables only the custom regex manager, so Renovate opens PRs for the Bridge pin in `bridge/Dockerfile` and nothing else (no npm, Docker or GitHub Actions PRs).

## Verification

1. Open https://github.com/k-leumas/sift/issues and look for an issue titled **Dependency Dashboard** (Renovate creates it within an hour or so of installation).
   Expected: it lists one dependency, `ProtonMail/proton-bridge` (`v3.27.0`) in `bridge/Dockerfile`, and no other managers.
2. When Proton releases a newer stable Bridge, a PR named like **Update dependency ProtonMail/proton-bridge to v3.x.y** appears.
   Expected in that PR:
   - the diff changes both `ARG BRIDGE_VERSION=` and `ARG BRIDGE_COMMIT=` in `bridge/Dockerfile`;
   - the PR body contains the note "BRIDGE_COMMIT must change together with BRIDGE_VERSION ...";
   - the `bridge-image` check runs (up to 45 minutes) and is green before you merge.
   If the diff changes only `BRIDGE_VERSION`, the `bridge-image` check fails on the commit check. Set `BRIDGE_COMMIT` to the tag's commit (`git ls-remote https://github.com/ProtonMail/proton-bridge refs/tags/v3.x.y`) in the PR before merging (assumption A2 in 02-15-SUMMARY.md).

---

**Once all items complete:** Mark status as "Complete" at top of file.
