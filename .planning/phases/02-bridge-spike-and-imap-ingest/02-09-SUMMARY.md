---
phase: 02-bridge-spike-and-imap-ingest
plan: 09
subsystem: imap
status: complete
tags: [imap, imapflow, folder-source, examine, body-peek, d-11, dovecot, truncation, uidvalidity]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-07 ingest contracts (FolderSource, HeaderRecord, BodyNode, TextPart) and message.ts (HEADER_FIELDS, BODY_DOWNLOAD_MAX_BYTES, parseMessage, selectTextPart, attachmentsOf, toBodyText); 02-18 openImap/closeImap; 02-04 Dovecot test server and test-imap.ts helpers"
provides:
  - "apps/worker/src/imap/folder-source.ts: createFolderSource(client) implementing FolderSource over ImapFlow, toUidSet(uids)"
  - "apps/worker/test/support/test-imap.ts: setFlags(user, folder, uid, flags) (doveadm flags add)"
  - "apps/worker/test/fixtures/mail/*.eml: seven synthetic example.test messages (plain, alternative, html-only, attachment, encoded-headers, no-message-id, exact-64)"
affects: [02-10, 02-13, 02-15, 02-16, 02-19]

actuals:
  tokens: 9000
  tasks: 2
  commits: 3
plan_head_before: 2a9bfdcb4e9723b9003f3eabbc7b791bc5dd1263
plan_head_after: 51efce90727d6a50a61b9b6523dafb87e905b8d8

tech-stack:
  added: []
  patterns:
    - "Read-only adapter: mailboxOpen(folder, { readOnly: true }) (EXAMINE), fetchAll only (no fetch iterator), ImapFlow's BODY.PEEK fetches; no flag, copy, move, delete or append call"
    - "Folder guard by mailbox object identity: ImapFlow replaces client.mailbox on every SELECT/EXAMINE and clears it on close, so `client.mailbox === opened` proves our EXAMINE is still in effect"
    - "Exact truncation: download with maxBytes + 1 and report truncated when the decoded output is longer than maxBytes; cut on a UTF-8 character boundary"
    - "Client double (plain object cast to ImapFlow) for paths a real server cannot be made to take: failed SEARCH, missing part, explicit READ-WRITE"

key-files:
  created:
    - apps/worker/src/imap/folder-source.ts
    - apps/worker/test/imap-folder-source.test.ts
    - apps/worker/test/fixtures/mail/plain.eml
    - apps/worker/test/fixtures/mail/alternative.eml
    - apps/worker/test/fixtures/mail/html-only.eml
    - apps/worker/test/fixtures/mail/attachment.eml
    - apps/worker/test/fixtures/mail/encoded-headers.eml
    - apps/worker/test/fixtures/mail/no-message-id.eml
    - apps/worker/test/fixtures/mail/exact-64.eml
  modified:
    - apps/worker/test/support/test-imap.ts

key-decisions:
  - "02-09: downloadText computes truncated from a download capped at maxBytes + 1 (truncated = decoded length > maxBytes), not from a server size. In ImapFlow 2.1.0, download meta.expectedSize is the whole message's RFC822.SIZE (download.js sets it from the size query) and BODYSTRUCTURE sizes count encoded bytes, while maxBytes caps the decoded UTF-8 output, so no reported size can say whether the decoded part was cut"
  - "02-09: listUids and searchSince throw when ImapFlow returns false (its signal for a failed SEARCH; an empty result is []). Returning [] would let the 02-10 removal diff mark every live message vanished"
  - "02-09: downloadText throws when the part or message is not found, instead of returning empty text that would be stored as a complete body"
  - "02-09: examine fails closed when the server explicitly grants READ-WRITE to EXAMINE; a missing READ-ONLY code is tolerated (EXAMINE itself is the read-only guarantee)"
  - "02-09: methods other than examine check that client.mailbox is the very object examine opened; errors name the method and the examined folder ('no folder examined yet', 'examining X did not succeed', 'the open folder is not X, the examined folder')"

patterns-established:
  - "Synthetic mail fixtures live in apps/worker/test/fixtures/mail, use only example.test addresses, and are delivered with doveadm save (UIDs 1..n in delivery order on a new folder)"
  - "D-11 flag test compares the full doveadm flag map before and after a pass, \\Recent included (EXAMINE must not clear it), and checks owner flags with \\Recent filtered out"

requirements-completed: [ING-01, ING-03]

coverage:
  - id: D1
    description: "createFolderSource examines read-only (readOnly true, uidValidity a number) and turns a real message into a HeaderRecord that parseMessage keys as mid: with the fixture's subject"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#examines read-only and fetches a real message into a HeaderRecord the parser accepts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Decoded, bounded text downloads: multipart/alternative plain part, base64 iso-8859-1 HTML to UTF-8, attachment never downloaded, maxBytes 64 truncation, exact-64 boundary both sides, UTF-8-safe cut"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#over realistic synthetic mail"
        status: pass
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#never cuts a UTF-8 character in half at the byte cap"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-11: flags identical after a full pass (examine, fetchDates, fetchHeaders, downloadText on every message), including a message pre-set to \\Flagged \\Answered; no \\Seen added"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#leaves every flag unchanged over a full adapter pass (D-11)"
        status: pass
      - kind: command
        ref: "! grep -nE '\\.(messageFlagsAdd|messageFlagsSet|messageFlagsRemove|messageMove|messageCopy|messageDelete|append)\\(' apps/worker/src/imap/folder-source.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Protocol edges the engine relies on: n:* returns the highest existing message, listUids ascending, searchSince finds fresh mail, a bumped UIDVALIDITY is reported by the next examine, RFC 2047 and no-Message-ID parsing"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#returns the highest message for n:* when nothing is new (RFC 3501)"
        status: pass
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#reports the new UIDVALIDITY after the server changes it"
        status: pass
    human_judgment: false
  - id: D5
    description: "Guards: every method before examine, after a failed examine, or with another folder open throws an Error naming the method and folder; failed SEARCH and a missing part throw; explicit READ-WRITE fails closed; toUidSet compression"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#createFolderSource guards (client double)"
        status: pass
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#refuses to read another folder than the examined one, or after a failed examine"
        status: pass
      - kind: test
        ref: "apps/worker/test/imap-folder-source.test.ts#toUidSet"
        status: pass
    human_judgment: false

duration: "about 25 min (8 min from the recorded start timer; context loading before it)"
completed: 2026-10-05
---

# Phase 2 Plan 09: IMAP FolderSource Adapter Summary

**A read-only FolderSource over ImapFlow (EXAMINE, fetchAll, BODY.PEEK) with exact maxBytes+1 truncation, fail-closed searches and folder guards, tested against Dovecot with seven synthetic messages. One of those tests shows that a full pass leaves every flag unchanged (D-11).**

## Performance

- **Duration:** about 25 min in total. The recorded timer ran from 2026-10-05T19:43:41Z to 19:51Z and does not include context loading.
- **Tasks:** 2 (a tracer, then a TDD task)
- **Files:** 10 (1 source, 1 test, 1 test helper, 7 fixtures)
- **Branch:** commits are on `main`, as intended for this phase (branching_strategy none)

## Accomplishments

- `createFolderSource(client)` implements all six FolderSource methods. It turns ImapFlow's bigint UIDVALIDITY into a number at the boundary.
- Envelope and BODYSTRUCTURE are mapped field by field, and nothing is spread. BODYSTRUCTURE is mapped iteratively, so deep nesting cannot overflow the stack.
- Records without a uid or a valid INTERNALDATE are rejected with an error that names the uid and leaves out the content.
- `toUidSet` sorts, deduplicates and compresses UID lists into ranges. It rejects an empty list and anything that is not a 32-bit UID.
- `downloadText` returns decoded UTF-8 text of at most maxBytes bytes, cut on a character boundary. `truncated` is true only when the decoded part really is longer than maxBytes. The exact-64 fixture tests both sides of the boundary.
- D-11 is proven on a real server: after a full pass, the doveadm flag map is identical to the one before it. That includes `\Recent`, which shows EXAMINE did not clear it, and a message pre-set to `\Flagged \Answered`. No message gained `\Seen`.
- Seven synthetic fixtures cover the realistic MIME cases:
  - quoted-printable UTF-8
  - multipart/alternative
  - base64 iso-8859-1 HTML with umlauts and a script tag
  - a multipart/mixed PDF attachment
  - an RFC 2047 subject and a folded From with a mixed-case domain
  - no Message-ID
  - an exactly 64-byte 7bit body

## Task Commits

1. **Task 1: tracer, examine and fetch a real message into a parsed HeaderRecord.** Commit `41c5c03` (feat). The tracer gate re-ran its verify command and it passed, so the plan moved on to Task 2.
2. **Task 2: search, bounded downloads, n:*, flags unchanged, UIDVALIDITY.** TDD:
   - RED: `a976f45` (test)
   - GREEN: `51efce9` (feat)
   - REFACTOR: none needed

## TDD Gate Compliance

- **RED (`a976f45`):** `pnpm vitest run apps/worker/test/imap-folder-source.test.ts` exited 1 with 5 of 20 tests failing on assertions:
  - exact-64 was reported as truncated, because expectedSize is the whole message's size
  - a failed SEARCH returned `[]`
  - a missing part returned empty text
  - a READ-WRITE open was accepted
  - a character was cut in half

  `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed, junit evidence).
- **GREEN (`51efce9`):** 20 of 20 pass. Lint and typecheck exit 0.

## Files Created/Modified

- `apps/worker/src/imap/folder-source.ts`: createFolderSource and toUidSet
- `apps/worker/test/imap-folder-source.test.ts`: 20 cases (toUidSet, client-double guards, Dovecot behaviour)
- `apps/worker/test/support/test-imap.ts`: `setFlags` (doveadm `flags add` through execFile with an argument array)
- `apps/worker/test/fixtures/mail/{plain,alternative,html-only,attachment,encoded-headers,no-message-id,exact-64}.eml`: synthetic messages that use only example.test addresses

## Decisions Made

See `key-decisions` in the frontmatter. In short:

- Truncation is measured on the decoded output by asking for one extra byte.
- A failed SEARCH and a missing part throw instead of returning empty data.
- An explicit READ-WRITE grant fails closed.
- The folder guard compares mailbox object identity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `truncated` from a server-reported size is wrong for decoded text**
- **Found during:** Task 2 (the RED exact-64 case)
- **Issue:** The plan's formula was `(meta.expectedSize ?? BODYSTRUCTURE size) > maxBytes`. In ImapFlow 2.1.0, `expectedSize` is the RFC822.SIZE of the whole message, so a 64-byte body plus its headers always counted as truncated. BODYSTRUCTURE sizes count encoded bytes, but `maxBytes` caps the decoded UTF-8 output. Base64 and quoted-printable shrink when decoded and latin-1 grows, so the formula was wrong in both directions. That is the reviewer's concern from Cursor MEDIUM L609.
- **Fix:** Download with `maxBytes + 1`. `truncated` is true when the decoded output is longer than maxBytes, and the text is cut to maxBytes on a UTF-8 boundary. The must-have truth still holds: truncated is true only when the part was actually cut. Only the mechanism in the truth's parenthesis changed.
- **Files modified:** apps/worker/src/imap/folder-source.ts
- **Commit:** 51efce9

**2. [Rule 1 - Bug] A failed SEARCH was read as an empty folder**
- **Found during:** Task 2
- **Issue:** The interfaces block said "[] when the server returns false". ImapFlow returns `false` only when the SEARCH command fails (search.js catch), and an empty result is `[]`. The 02-10 removal diff would then mark every live location vanished, and a backfill would silently find nothing.
- **Fix:** listUids and searchSince throw `FolderSource.<method>: UID SEARCH failed in <folder>`. searchSince also rejects an invalid Date.
- **Commit:** 51efce9

**3. [Rule 2 - Missing critical] Not-found downloads and READ-WRITE grants**
- **Found during:** Task 2
- **Fix:**
  - downloadText throws when ImapFlow finds no part or message, instead of returning empty text that would be stored as a body.
  - examine throws when the server explicitly answers EXAMINE with READ-WRITE.
  - The folder guard compares the client's mailbox object with the one examine opened. Comparing paths would also accept a read-write SELECT of the same folder.
- **Commit:** 51efce9

**4. [Rule 1 - Test bug] `\Recent` in the doveadm flag list**
- **Found during:** Task 2, while writing the RED tests
- **Issue:** doveadm lists `\Recent` for mail that no session has seen yet, so the pre-flag check `['\Answered', '\Flagged']` failed before any adapter code ran.
- **Fix:**
  - The owner-flag checks filter out `\Recent`.
  - The before/after comparison still uses the full map, so it would catch EXAMINE clearing `\Recent`. It did not clear it.
- **Commit:** a976f45

### Test Approach Notes

- The UIDVALIDITY case re-examines on the same connection. Dovecot reports the bumped value on the next EXAMINE without dropping the session.
- "The attachment part is never downloaded" is checked with a spy on `client.download` during the attachment message's pass: only part `1` is requested.

**Total deviations:** 4 auto-fixed (2 bugs, 1 missing critical, 1 test bug). **Impact:** the adapter is stricter than the interfaces block. The 02-10 engine receives errors where it would otherwise have received empty data, which suits the owner's fail-closed preference. The signatures did not change.

## Issues Encountered

None. Full suite: `pnpm test` gave 37 files and 650 tests passing on the first run, with no intermittent failure seen. `pnpm lint` and `pnpm typecheck` exit 0.

## Threat Model Coverage

- T-02-31 (read state or flags): EXAMINE, BODY.PEEK, the static ban grep and the Dovecot flags-unchanged test.
- T-02-32 (huge downloads): maxBytes + 1 cap, and only the selected part is fetched.
- T-02-33 (fetch-iterator deadlock, long UID lines): fetchAll only, plus toUidSet.

## Known Stubs

None.

## Next Phase Readiness

The FolderSource the 02-10 engine depends on is ready. The engine should know three things:
- listUids, searchSince and downloadText throw on server failure; they do not return empty data.
- fetchDates(`n:*`) returns the highest existing message, which the engine must drop when its uid is at or below lastUid.
- searchSince is day-granular.

## Self-Check: PASSED

- All 10 key files exist on disk.
- Commits 41c5c03, a976f45 and 51efce9 are present in `git log`.
- Every acceptance criterion was re-run and passes:
  - `readOnly: true` is present.
  - There are no flag, move, copy, delete or append calls.
  - fetchAll appears 2 times and the source has no iterator loop.
  - 10 `@example.test` lines are present and no real-provider addresses.
  - `setFlags` is exported.
  - Tests, lint and typecheck pass.
