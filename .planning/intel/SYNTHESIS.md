# Ingest Synthesis Summary

Mode: new. Precedence: ADR > SPEC > PRD > DOC. Entry point for gsd-roadmapper.

## Documents consumed (4)
- ADR: 3 (all locked, all Accepted, high confidence)
  - /Users/samuel/dev/sift/docs/adr/0001-multiple-mailboxes-single-owner.md
  - /Users/samuel/dev/sift/docs/adr/0002-tiered-classification.md
  - /Users/samuel/dev/sift/docs/adr/0003-traces-and-mail-app-relabels.md
- SPEC: 0
- PRD: 0
- DOC: 1 (manifest override, high confidence)
  - /Users/samuel/dev/sift/README.md
- UNKNOWN / low confidence: 0

## Cycle detection
Graph built from `cross_refs`: ADR-0003 -> ADR-0002; README -> ADR-0002, ADR-0001, LICENSE (not ingested); ADR-0001 and ADR-0002 reference only non-ingested paths. No cycles. (ADR-0002 mentions the README in prose only, not in its recorded cross_refs, so no README <-> ADR cycle is in the graph.)

## Decisions locked: 3
See /Users/samuel/dev/sift/.planning/intel/decisions.md
- ADR-0001 mailbox isolation, single owner, RLS, per-mailbox learning/rules/credentials
- ADR-0002 three-tier classification; the classifier trains only on owner-confirmed labels; quick confirm; distillation only as experiment
- ADR-0003 decision traces; relabel detection via IMAP polling; trace-based correction routing

## Requirements: 0
See /Users/samuel/dev/sift/.planning/intel/requirements.md. No PRDs in the set; nothing was inferred. The roadmap in the README (M1-M7, DOC) is the only statement of intended scope and is held in context.md.

## Constraints: 0
See /Users/samuel/dev/sift/.planning/intel/constraints.md. No SPECs in the set.

## Context topics: 13
See /Users/samuel/dev/sift/.planning/intel/context.md. Topics: product positioning; pipeline overview; tier details; learning from the mail app; decision traces; plain-English rules configuration; technical settings; data model; security model; evals; deployment; project structure and stack; roadmap M1-M7; contributing and license.

## Conflicts
- Blockers: 0
- Competing variants (warnings): 0
- Auto-resolved (info): 1 (ADR-0001 vs README on `mailbox_id` scoping of rule sets and eval runs)
- Report: /Users/samuel/dev/sift/.planning/INGEST-CONFLICTS.md

## Notes for the roadmapper
- No LOCKED-vs-LOCKED contradictions; the three ADRs are mutually consistent (ADR-0003 builds on ADR-0002; ADR-0001 scoping is compatible with both).
- ADR-0003 flags an M1 spike on Proton Bridge (CONDSTORE/QRESYNC, Message-ID consistency across label folders) as a prerequisite for relabel learning; the README roadmap places that spike in M1 and relabel learning in M2.
- Requirements will need to be derived from the README roadmap and ADRs by the roadmapper or the user; this synthesis does not generate them.

## Files
- /Users/samuel/dev/sift/.planning/intel/decisions.md
- /Users/samuel/dev/sift/.planning/intel/requirements.md
- /Users/samuel/dev/sift/.planning/intel/constraints.md
- /Users/samuel/dev/sift/.planning/intel/context.md
- /Users/samuel/dev/sift/.planning/INGEST-CONFLICTS.md
