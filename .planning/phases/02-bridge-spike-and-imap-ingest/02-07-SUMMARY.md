---
phase: 02-bridge-spike-and-imap-ingest
plan: 07
subsystem: ingest
tags: [imap, identity, libmime, html-to-text, parsing, hostile-input, tdd]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-04 approved and installed libmime 5.4.4, html-to-text 10.0.1 and their @types"
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-03 message_identity_key_check (`pm:.+ | mid:.+ | hdr:v<n>:<64 hex>`)"
provides:
  - "apps/worker/src/ingest/types.ts: FolderSource, IngestStore, HeaderRecord, BodyNode, ParsedMessage, MessageRecord, FolderState, BackfillState, ChunkAdvance, ResyncCounts, LiveLocationRef, IngestOutcome, IngestLog (types only)"
  - "apps/worker/src/ingest/identity.ts: stripNul, truncateCodePoints, normaliseMessageId, stableHeaderHash, identityKey, HDR_HASH_INPUTS, HDR_KEY_VERSION ('v1'), MESSAGE_ID_MAX_BYTES (998)"
  - "apps/worker/src/ingest/message.ts: HEADER_FIELDS, parseHeaderBlock, parseMessage, selectTextPart, attachmentsOf, toBodyText, the size caps, HTML_MAX_DEPTH (200)"
affects: [02-09, 02-10, 02-11, 02-13, 02-14, 02-19]

actuals:
  tokens: 9978
  tasks: 2
  commits: 3
plan_head_before: 1b15a9f694e17978515a4605e551a258333bf5da
plan_head_after: 29e6b9ce7d6b28ddd801b25f0ff568ecb88097f7

tech-stack:
  added: []
  patterns:
    - "Identity reads the raw (not RFC 2047-decoded) Message-ID and X-Pm-Internal-Id; the hdr: hash uses raw values too, so a libmime upgrade cannot change stored keys"
    - "Every stored string goes through clean(): NUL strip, toWellFormed(), code-point cap"
    - "BODYSTRUCTURE walked iteratively (explicit stack); message/* parts are never entered"

key-files:
  created:
    - apps/worker/src/ingest/types.ts
    - apps/worker/src/ingest/identity.ts
    - apps/worker/src/ingest/message.ts
    - apps/worker/test/ingest-identity.test.ts
    - apps/worker/test/ingest-message.test.ts
  modified: []

key-decisions:
  - "A normalised Message-ID longer than 998 UTF-8 bytes (RFC 5322 line limit) gives null and falls through to hdr:v1:, so a hostile header can never exceed the btree row limit on UNIQUE (mailbox_id, identity_key)"
  - "stableHeaderHash is fed the raw (undecoded) header values, not the libmime-decoded ones: the hash depends only on the received bytes and the unfold rule"
  - "A value with a malformed B-encoded word keeps its whole raw text (libmime would decode `=?utf-8?B?***?=` to an empty string)"
  - "html-to-text gets limits.maxDepth 200 (HTML_MAX_DEPTH); without it ~50k nested elements overflow the stack"
  - "Attached messages (message/*) are listed as attachments when they carry a disposition or name, and their inner parts are neither the body nor separate attachments"

patterns-established:
  - "Hostile-input tests use synthetic header blocks on example.test, never real mail"

requirements-completed: [ING-02]

coverage:
  - id: D1
    description: "Shared ingest contracts (FolderSource, IngestStore and the record types) with no IMAP client or database imports"
    requirement: ING-02
    verification:
      - kind: other
        ref: "pnpm typecheck; ! grep -nE \"from '(imapflow|@sift/db|pg|drizzle-orm)\" apps/worker/src/ingest/*.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deterministic pm:/mid:/hdr:v1: identity keys with D-13 normalisation and Bridge-only pm: trust"
    requirement: ING-02
    verification:
      - kind: unit
        ref: "apps/worker/test/ingest-identity.test.ts#identityKey (D-12)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/ingest-identity.test.ts#normaliseMessageId (D-13)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/ingest-identity.test.ts#parseMessage identity"
        status: pass
    human_judgment: false
  - id: D3
    description: "Header parsing that never throws on hostile input and gives NUL-free, capped, RFC 2047-decoded values"
    requirement: ING-02
    verification:
      - kind: unit
        ref: "apps/worker/test/ingest-identity.test.ts#hostile header blocks"
        status: pass
    human_judgment: false
  - id: D4
    description: "Body part selection, HTML to text without script/style/img/link targets, 32768 code-point cap, attachment metadata"
    requirement: ING-02
    verification:
      - kind: unit
        ref: "apps/worker/test/ingest-message.test.ts"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-05
status: complete
---

# Phase 2 Plan 07: Ingest Contracts and Message Parsing Summary

**Pure ingest parsing: a raw IMAP header record becomes a `ParsedMessage` with a `pm:`/`mid:`/`hdr:v1:` identity key (Bridge-only pm: trust, D-13 Message-ID normalisation). Header values are capped, NUL-free and RFC 2047-decoded by libmime. The body comes from text/plain first, else from HTML converted by html-to-text with depth limits. Attachments are recorded as metadata only. The contracts that 02-09, 02-10 and 02-13 build against are in place.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-05T18:42:16Z
- **Completed:** 2026-10-05T18:48:31Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments

- `types.ts` copies the plan's interfaces block exactly. It holds only types, with no imapflow, @sift/db, pg or drizzle imports.
- `identity.ts` implements:
  - `normaliseMessageId`: strips NUL, whitespace and one pair of angle brackets, and lowercases only the domain.
  - `stableHeaderHash`: canonical JSON of the HDR_HASH_INPUTS plus the size, then sha256.
  - `identityKey`: `pm:` only when `trustPmHeader` is set and the id matches `^[A-Za-z0-9_=-]{1,200}$`, else `mid:`, else `hdr:v1:<64 hex>`.
- `parseHeaderBlock` runs libmime `decodeHeaders(raw.toString('utf8'))` and then a safe `decodeWords`. It drops lines without a valid name, caps each value at 2000 code points and keeps at most 20 values per name. It never throws, including on garbage bytes and `__proto__` names.
- `parseMessage` takes the identity fields from the raw header bytes, never from the envelope. It lowercases only the sender domain, takes the subject from the envelope with the decoded header as fallback, and keeps `sentAt` only when the date is valid.
- `selectTextPart`, `attachmentsOf` and `toBodyText` implement D-06:
  - html-to-text runs with exactly the planned selectors (img, script and style skipped; `a` with `ignoreHref`), plus a depth limit.
  - Text is NUL-stripped and capped at 32768 code points.
  - A download that was already truncated keeps `truncated: true`.
  - A message with no text part gives source `none`.

## Task Commits

1. **Task 1 (tracer): Ingest contracts and identity-keyed header parsing**: `c3fc0e9` (feat)
2. **Task 2 RED: failing tests for body text, HTML conversion and attachments**: `95c3871` (test)
3. **Task 2 GREEN: body text part selection, HTML conversion, attachment metadata**: `29e6b9c` (feat)

No refactor commit was needed. All commits are on `main` (branching_strategy=none for this phase, as instructed).

## TDD Gate Compliance

- RED `95c3871`: `pnpm vitest run apps/worker/test/ingest-message.test.ts` exited 1, with 16 of 21 tests failing on assertions against placeholder stubs. The stubs return null, empty text with source `none`, and `[]`. They were committed with the test so RED would fail on behaviour, not on missing exports. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed, target `apps/worker/test/ingest-message.test.ts`, junit evidence).
- GREEN `29e6b9c`: both ingest test files pass (53 tests).
- Tracer gate (Task 1): auto mode is off and human_verify_mode is end-of-phase, and the verify step is automated only. `<verify>` was re-run (31 tests, typecheck exit 0) before Task 2 started, and it passed.

## Files Created/Modified

- `apps/worker/src/ingest/types.ts`: ingest contracts (types only)
- `apps/worker/src/ingest/identity.ts`: identity keys, NUL strip and code-point truncation
- `apps/worker/src/ingest/message.ts`: header fields, caps, header parsing, parseMessage, body selection and conversion, attachment metadata
- `apps/worker/test/ingest-identity.test.ts`: 31 tests covering identity, normalisation, the hash and hostile headers
- `apps/worker/test/ingest-message.test.ts`: 22 tests covering body selection, HTML conversion, caps and attachments

## Decisions Made

See the key-decisions list in the frontmatter. In short: Message-IDs over 998 bytes fall through to `hdr:`, the hdr hash reads raw header values, a malformed encoded word keeps its raw text, HTML depth is capped at 200, and attached messages are never entered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Over-long Message-ID falls through to hdr:**
- **Found during:** Task 1
- **Issue:** A Message-ID of several kB would produce a `mid:` key above Postgres's btree row limit (~2.7 kB) on `UNIQUE (mailbox_id, identity_key)`. The insert would fail, so the chunk holding that mail could never commit (a DoS like Pitfall 7).
- **Fix:** `normaliseMessageId` returns null when the normalised id is over `MESSAGE_ID_MAX_BYTES = 998` UTF-8 bytes (the RFC 5322 line limit), so the key falls through to `hdr:v1:`. Tested.
- **Files modified:** apps/worker/src/ingest/identity.ts, apps/worker/test/ingest-identity.test.ts
- **Commit:** c3fc0e9

**2. [Rule 1 - Bug] Deeply nested HTML overflowed html-to-text's recursion**
- **Found during:** Task 2 (probe of the installed html-to-text 10.0.1)
- **Issue:** A 262144-byte body of about 52k nested `<div>` or `<b>` elements makes `convert()` throw `RangeError: Maximum call stack size exceeded`. One hostile mail would block ingest.
- **Fix:** `limits: { maxDepth: HTML_MAX_DEPTH (200), ellipsis: '' }` in the convert options. A test converts 52k nested divs. Logged as bug-138 in .wolf/buglog.json.
- **Files modified:** apps/worker/src/ingest/message.ts, apps/worker/test/ingest-message.test.ts
- **Commit:** 29e6b9c

**3. [Rule 2 - Missing critical] Attached messages are not entered**
- **Found during:** Task 2
- **Issue:** Under a plain depth-first walk, a forwarded `message/rfc822` part's inner text/plain would become the outer message's body, and its inner attachments would be listed as the outer message's.
- **Fix:** The walk yields `message/*` nodes but never enters them. Tested ("does not take the body of an attached message").
- **Commit:** 29e6b9c

**4. [Rule 2 - Missing critical] Malformed encoded word keeps raw text**
- **Found during:** Task 1
- **Issue:** libmime decodes `=?utf-8?B?***?=` to an empty string without throwing, so a try/catch alone would not keep the raw text the plan requires.
- **Fix:** `decodeWordsSafe` checks every B-encoded word against a base64 pattern and keeps the raw value if one fails, and it also catches exceptions.
- **Commit:** c3fc0e9

**Total deviations:** 4 auto-fixed (1 bug, 3 missing critical). **Impact:** all of them harden hostile-input handling. None changes a contract or a planned key format.

## Issues Encountered

None. The full suite passed on the first run (34 files, 559 tests), so the known intermittent failure did not appear and its test was not identified.

## Known Stubs

None. The Task 2 RED placeholders were replaced in the GREEN commit.

## Threat Flags

None. No new network, auth, file or schema surface. T-02-23/24/25 are mitigated as planned and tested.

## Next Phase Readiness

- 02-09 (IMAP adapter) implements `FolderSource` and fetches `HEADER_FIELDS`. It should pass `BODY_DOWNLOAD_MAX_BYTES` to `downloadText`.
- 02-10 (engine) and 02-13 (worker store) build on `IngestStore`, `MessageRecord` and `parseMessage`. The spike (02-11/02-14) reuses `identityKey` and `stableHeaderHash`, and A6 stays open until the spike confirms the hash inputs.

## Self-Check: PASSED

- FOUND: apps/worker/src/ingest/types.ts, identity.ts, message.ts; apps/worker/test/ingest-identity.test.ts, ingest-message.test.ts
- FOUND commits: c3fc0e9, 95c3871, 29e6b9c
- Verification: `pnpm vitest run apps/worker/test/ingest-identity.test.ts apps/worker/test/ingest-message.test.ts` passes (53); `pnpm lint` exit 0; `pnpm typecheck` exit 0; `pnpm test` 559/559
