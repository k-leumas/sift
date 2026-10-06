# ADR 0003: Decision traces, and learning from relabels in the mail app

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

[ADR 0002](0002-tiered-classification.md) says the classifier trains only on labels the owner confirmed. That raises two practical questions.

**Where do corrections come from?** So far, from Sift's own UI: the review queue and quick confirm. But the owner reads and sorts mail in their normal mail app, not in Sift. When a label is wrong, the natural move is to fix it right there. If Sift ignores that, its best source of corrections is wasted, and the owner has to fix every mistake twice.

**What should a correction fix?** A wrong label can come from any tier. If an exact rule caused it, retraining the classifier doesn't help. If the LLM caused it, the fix is a better example or prompt. Sift can only send a correction to the right place if it knows how the original decision was made, in enough detail to tell the tiers apart.

## Decision

### 1. Every classification produces a decision trace

A trace is stored for each decision, structured as one span per tier that ran, plus the final action:

- **Exact rules:** how many rules were checked, which matched (if any), and the nearest miss.
- **Classifier:** version, top category scores, the neighbor emails used, the threshold, and whether it escalated.
- **LLM:** model, prompt version, rules included, examples retrieved, raw output, validation result and confidence.
- **Action:** what was done in the mailbox and when, or that the email went to review.
- **Versions:** rule set, classifier, prompt and model, so the decision can be replayed later.

Traces live in Sift's database (the `decision` table) and are shown in the UI behind a **Why?** link. IMAP can't attach notes to a message, so nothing is written into the mailbox itself.

### 2. Sift detects relabels made in the mail app and treats them as owner labels

- **Detection.** For each label folder (Proton Bridge exposes labels as folders like `Labels/Noise`), Sift compares the current set of messages with the last set it saw, on a short polling interval (default 60 seconds). Where the server supports CONDSTORE/QRESYNC, it requests only changes since the last check. The folder's UIDVALIDITY is stored, and a change to it triggers a full resync of that folder.
- **Identity.** IMAP gives the same message a different UID in every folder, so messages are matched across folders by their `Message-ID` header. Messages without one fall back to a hash of stable headers.
- **State, not time windows.** Each message's label state lives in its database row. A removal and a later addition are paired by message, however far apart they happen. Nothing is held in memory between polls except what's being processed.
- **Echo suppression.** Sift records every change it makes to the mailbox and ignores those changes when it sees them during sync.

### 3. How detected changes are interpreted

| Observed on a message Sift labeled | Interpretation | Result |
|---|---|---|
| Sift's label removed and another added | Correction | Owner label; the classifier trains on it |
| Sift's label removed, nothing added | Rejection without an answer | No training; asked in quick confirm |
| Another label added, Sift's kept | Ambiguous | No training; asked in quick confirm |
| Message deleted | Cleanup | Ignored |
| Sift's own change | Echo | Ignored |
| No change, however long | Not a confirmation | Never trains |

### 4. Corrections are routed using the trace

- **An exact rule caused it:** suggest a rule edit to the owner. Don't retrain.
- **The classifier caused it:** retrain the classifier with the corrected label.
- **The LLM caused it:** add the email as a retrieval example and to the mailbox's private eval set.

## Consequences

**Positive**

- The owner's normal mail app becomes the main training interface. Corrections happen where the owner already works, and there are many more of them.
- Every wrong label can be explained after the fact, and replayed against current versions.
- Corrections fix the part of the system that actually failed, instead of always retraining the classifier.
- Corrected LLM mistakes become regression tests for future prompt and model changes.
- Traces map directly onto the span model used by LLM observability tools, so exporting them later is straightforward.

**Negative**

- Polling every label folder adds steady background IMAP traffic per mailbox. It's small (lists of integers), but it isn't free.
- Behavior depends on the server. Proton Bridge's support for CONDSTORE/QRESYNC, and how consistently it preserves `Message-ID` across label folders, must be verified in an M1 spike. The polling fallback must work without either.
- Traces add storage per decision. Raw LLM prompts are the largest part; they may need a retention limit (for example, keeping full prompts for 90 days and the summary forever).
- Relabels made while Sift is offline are still detected on the next sync, but in a rare case where a message is relabeled twice between syncs, only the final state is seen.

## Alternatives considered

**Only learn from corrections made in Sift's UI.** Simpler, but it ignores where the owner actually fixes mistakes and forces them to do it twice. Rejected.

**Treat labels left unchanged for N days as confirmed.** It would grow the training set quickly, but silence doesn't mean the owner checked. That would break ADR 0002's rule that only the owner's judgment trains the classifier. Rejected.

**Pair removals and additions within a time window.** It needs an arbitrary window, misses slow corrections, and holds state in memory. Per-message state in the database handles any delay. Rejected.

**Write the trace into the mailbox** (as a header, note or draft). IMAP can't modify an existing message, and adding companion messages would clutter the owner's mail. Rejected.

**A flat log line per decision instead of a structured trace.** Easier to write, but it can't be replayed, routed on or exported to observability tools. Rejected.

## Note: message identity is pending the Proton Bridge spike

*Added 2026-10-03.*

How a message is identified isn't decided yet. It depends on what the Phase 2 Proton Bridge spike finds. Until then:

- The `message` table has only keys and timestamps (`id`, `mailbox_id`, `created_at`, `updated_at`).
- There is **no unique constraint on `Message-ID`**. Adding one before we know Bridge keeps it consistent across label folders would be the expensive kind of mistake.
- Test fixtures that need readable emails carry subject and sender as fixture data, not as schema columns.

The spike must answer:

1. **Identity key:** is the `Message-ID` header present and stable across `INBOX` and every `Labels/*` folder? What is the fallback when it's missing or duplicated (for example, a hash of stable headers)?
2. **Per-folder UIDs:** how UIDs and UIDVALIDITY behave per label folder, and what triggers a full resync.
3. **Timestamps:** whether `received_at` comes from IMAP `INTERNALDATE` or the `Date` header.
4. **Change tracking:** whether Bridge supports CONDSTORE/QRESYNC, or whether polling is the only option.

The answers will be recorded as an addendum to this ADR. The identity columns and their constraints will then be added in a single migration that follows it.

## Addendum (2026-10): Proton Bridge spike (M1)

*Added 2026-10-06.* Full results, measured on Proton Bridge v3.27.0 against the owner's real mailbox: [.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md](../../.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md).

The spike answers the four questions of the note above:

1. **Identity key:** Bridge adds an `X-Pm-Internal-Id` header to every message. It is unique per message and byte-identical in `INBOX` and in a label folder. `Message-ID` is also preserved byte-for-byte, but 1.6% of Message-IDs are shared by distinct Proton messages. The key order is therefore Bridge's internal ID first (`pm:`), then `Message-ID` (`mid:`), then the versioned stable-header hash (`hdr:v1:`). The last two serve non-Bridge servers.
2. **Per-folder UIDs:** each label folder has its own UIDVALIDITY. UIDVALIDITY and UIDs stayed the same across two Bridge restarts. A forced Bridge repair was not tested and is treated as a UIDVALIDITY reset (full folder rescan).
3. **Timestamps:** `received_at` comes from IMAP `INTERNALDATE`. It survived the restarts unchanged. During Bridge's initial sync, UIDs are assigned newest-first, so INTERNALDATE, not UID order, decides what counts as new mail.
4. **Change tracking:** Bridge advertises neither CONDSTORE nor QRESYNC, and it rejects ENABLE and STATUS HIGHESTMODSEQ. Relabel detection (section 2 above) is **polling only**: a UID-set diff per label folder, matched by the internal ID, with a UIDVALIDITY check on every poll.

**Label apply and remove.** A label is applied with `UID COPY` into `Labels/<name>` from a SELECTed source folder (Bridge refuses COPY from an EXAMINEd one). COPYUID names the label-folder copy, and Sift records it for echo suppression. A label is removed with `\Deleted` plus `UID EXPUNGE` of that one UID in the label folder. The `INBOX` copy survives both.

**Raw-prompt retention (the open item under Negative consequences).** Resolved by Phase 2 decision D-09: traces store the **prompt recipe**, meaning the prompt version, the rule-set version and the Message-IDs of the examples used, not the raw rendered prompt. The prompt can be rebuilt from versioned sources when needed, so no retention limit is required for prompts. The LLM's raw output stays in the trace unchanged.
