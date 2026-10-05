---
phase: 02-bridge-spike-and-imap-ingest
plan: 18
subsystem: imap
status: complete
tags: [imap, tls, starttls, spki-pin, imapflow, d-80, fake-server, wire-test]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-04 pin.ts (spkiSha256, peerSpkiSha256, pemFromDer), the Dovecot test server (scripts/test-imap.sh, test-imap.ts), imapflow 2.1.0"
provides:
  - "apps/worker/src/imap/capture.ts: capturePeerCertificate, CapturedCertificate (the one verification-off handshake, D-80)"
  - "apps/worker/src/imap/connect.ts: openImap, closeImap, classifyImapError, PinMismatchError, BridgeConnectOptions, ImapErrorClass, OpenImapDeps"
  - "apps/worker/test/support/fake-imap-server.ts: startFakeImapServer, makeTestCertificates, FakeConnection, TestCertificate"
  - "Error codes SIFT_TLS_PIN_MISMATCH, SIFT_NO_STARTTLS, SIFT_TLS_CAPTURE_TIMEOUT, SIFT_TLS_REQUIRED"
affects: [02-09, 02-11, 02-13, 02-15, 02-16]

actuals:
  tokens: 13100
  tasks: 3
  commits: 5
plan_head_before: e7d44979f2615fd64a5b230cc6685111b0f14736
plan_head_after: d97d31baca6d609c54d22f49d8ed1bdd526065f7

tech-stack:
  added: []
  patterns:
    - "Pinned login = capture on a credential-free handshake, compare SPKI, then `ca: [captured PEM]` plus an SPKI checkServerIdentity on the login connection"
    - "Plaintext guard on ImapFlow: client.run wrapped so only CAPABILITY and STARTTLS cross before TLS"
    - "Recording fake IMAP server as the source of truth for wire-level assertions (plaintext lines and decrypted bytes per connection)"

key-files:
  created:
    - apps/worker/src/imap/capture.ts
    - apps/worker/src/imap/connect.ts
    - apps/worker/test/support/fake-imap-server.ts
    - apps/worker/test/imap-capture.test.ts
    - apps/worker/test/imap-connect.test.ts
  modified:
    - apps/worker/src/imap/pin.ts
    - apps/worker/test/imap-pin.test.ts

key-decisions:
  - "02-18: ImapFlow sends ID (client name, version, vendor) before STARTTLS whenever the server advertises ID, which Bridge and Dovecot do, and omitting clientInfo does not stop it. openImap wraps client.run: before TLS only CAPABILITY and STARTTLS pass, ID and LOGOUT are skipped, and anything else rejects with SIFT_TLS_REQUIRED. ID is sent again after login, over TLS"
  - "02-18: the capture closes its TLS session with end() (Finished plus close_notify, no IMAP data) and destroys the socket after 1 s if the server has not closed. Destroying at once dropped the TLS 1.3 client Finished"
  - "02-18: peerSpkiSha256 hashes the SPKI exported from the DER certificate (cert.raw). For EC keys, Node's PeerCertificate.pubkey is the bare curve point, so the old code could never match a pin for an EC server"
  - "02-18: classifyImapError reads only codes and ImapFlow's flags (authenticationFailed, tlsFailed), following cause up to 5 levels; message text is never read"
  - "02-18: openImap attaches a no-op 'error' listener, because ImapFlow closes the connection before emitting and the next command rejects with NoConnection. Without a listener the emit would throw from a socket callback"

patterns-established:
  - "Wire tests build forbidden literals (the verification-off option, the authentication command names, fs imports) from string parts"
  - "openssl-made EC test certificates (captured, unrelated, issuedByCaptured) are generated in a mkdtemp directory that is removed before the helper returns"

requirements-completed: [ING-01]

coverage:
  - id: D1
    description: "openImap logs in to the self-signed Dovecot server over STARTTLS through capture, pin comparison and a login connection verified twice"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-connect.test.ts#logs in over STARTTLS through the capture, the pin and a doubly verified connection"
        status: pass
    human_judgment: false
  - id: D2
    description: "The capture connection carries only `<tag> STARTTLS` and the TLS handshake (starttls), or only the handshake (implicit), with zero bytes of IMAP data afterwards; no-STARTTLS, BAD, no-capability-code and never-greets cases"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-capture.test.ts#capturePeerCertificate on the wire (D-80)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Static D-80 guarantees: only capture.ts turns verification off, capture.ts names no authentication command, and neither capture.ts nor connect.ts imports fs"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-capture.test.ts#static guarantees (D-80)"
        status: pass
      - kind: command
        ref: "grep -rlE 'rejectUnauthorized:\\s*false' apps/worker/src  ->  apps/worker/src/imap/capture.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "A certificate swapped between the capture and the login fails before any login command: unrelated gives cert_untrusted, issued-by-captured gives pin_mismatch, in starttls and implicit mode"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-connect.test.ts#openImap fails closed against fake servers"
        status: pass
    human_judgment: false
  - id: D5
    description: "Pin mismatch before any client, no pin gives cert_untrusted, no STARTTLS gives no_starttls, a closed port gives unreachable, a wrong password gives auth_rejected, and every call captures afresh"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-connect.test.ts#openImap against the Dovecot test server"
        status: pass
    human_judgment: false
  - id: D6
    description: "On the login connection only CAPABILITY and STARTTLS cross before TLS, including with a Bridge-like greeting that offers ID"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-connect.test.ts#sends only CAPABILITY and STARTTLS before TLS on the login connection"
        status: pass
    human_judgment: false
  - id: D7
    description: "classifyImapError maps codes and flags to stable classes"
    verification:
      - kind: test
        ref: "apps/worker/test/imap-connect.test.ts#classifyImapError"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-10-05
---

# Phase 2 Plan 18: Pinned, Fail-Closed IMAP Connection Summary

**The worker logs in to IMAP only over STARTTLS or implicit TLS. For a pinned server such as Bridge, the presented certificate is read on a handshake that writes nothing but `C1 STARTTLS`, its SPKI is compared with the pin, and the login connection trusts only that certificate and checks the pin again. ImapFlow's plaintext ID is suppressed, and wire tests show that a certificate swapped between the two connections fails before any login command is sent.**

## Performance

- **Duration:** about 20 min
- **Started:** 2026-10-05T19:18:03Z
- **Completed:** 2026-10-05T19:38:27Z
- **Tasks:** 3 of 3
- **Files:** 5 created, 2 modified
- **Commits:** made directly on `main` (branching_strategy=none), as the orchestrator intended

## Accomplishments

- `capturePeerCertificate` (D-80) is the only code under `apps/worker/src` that turns certificate verification off. It reads STARTTLS support from the greeting's capability code and never sends a capability request. The one line it writes is `C1 STARTTLS`. It returns `{ pem, spkiSha256, validTo, subject }` and keeps nothing.
- `openImap`:
  - Uses `secure: false, doSTARTTLS: true` or `secure: true`.
  - With a pin: captures on every call, throws `PinMismatchError` before any client exists, then sets `tls: { ca: [captured.pem], minVersion: 'TLSv1.2', checkServerIdentity }`. checkServerIdentity re-checks the SPKI and ignores the hostname.
  - Without a pin: Node's default chain and hostname verification applies.
  - Also sets `logger: false`, `disableAutoIdle: true` and `clientInfo: { name: 'Sift' }`.
- `closeImap` bounds logout to 5 s and never throws. `classifyImapError` returns one of unreachable, timeout, auth_rejected, pin_mismatch, cert_untrusted, no_starttls or protocol.
- The recording fake IMAP server (plain, STARTTLS, implicit; a certificate per connection) is the evidence for D-80 on the wire. The test certificates are made with openssl.

## Task Commits

1. **Task 1 (tracer): pinned STARTTLS login to Dovecot**: `9dc3855` (feat)
2. **Task 2: the capture proven on the wire**: `a2e4077` (test, RED: 2 failures on `upgraded`), then `87f571f` (fix, GREEN)
3. **Task 3: openImap fails closed**: `6b8e3bc` (test, RED: 3 failures, the EC pin and the login-connection upgrade), then `d97d31b` (fix, GREEN)

## Files Created/Modified

- `apps/worker/src/imap/capture.ts`: the verification-off certificate capture, with a D-80 header comment
- `apps/worker/src/imap/connect.ts`: openImap, the plaintext guard, closeImap, classifyImapError, PinMismatchError
- `apps/worker/src/imap/pin.ts`: peerSpkiSha256 now hashes the SPKI taken from `cert.raw`
- `apps/worker/test/support/fake-imap-server.ts`: the recording fake server and makeTestCertificates
- `apps/worker/test/imap-capture.test.ts`: 11 cases (6 wire, 1 Dovecot, 4 static)
- `apps/worker/test/imap-connect.test.ts`: 34 cases (Dovecot, fake servers, the classifier table, the mode options)
- `apps/worker/test/imap-pin.test.ts`: new case, peerSpkiSha256 of an EC peer certificate

## Decisions Made

See `key-decisions` in the frontmatter. The plaintext guard, the close_notify close and the SPKI-from-raw fix all came from failures the plan's own tests exposed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] peerSpkiSha256 never matched a pin for EC certificates**
- **Found during:** Task 3. The login connection to the fake server, with an EC certificate, failed with PinMismatchError even though the pin was correct.
- **Issue:** Node's `PeerCertificate.pubkey` is the DER SPKI only for RSA keys. For EC keys it is the bare curve point. Bridge's and Dovecot's RSA certificates hid the bug, but a pinned EC server would always have failed. That failure was closed (safe) but wrong.
- **Fix:** hash `new X509Certificate(cert.raw).publicKey.export({ type: 'spki', format: 'der' })`. A new imap-pin test covers an EC peer.
- **Files modified:** apps/worker/src/imap/pin.ts, apps/worker/test/imap-pin.test.ts
- **Commit:** d97d31b

**2. [Rule 1 - Bug] Destroying the capture socket at once dropped the TLS handshake Finished**
- **Found during:** Task 2. In the starttls and implicit wire cases, the fake server never saw the handshake complete (`upgraded` was false).
- **Issue:** the plan said "destroy the socket at once". With TLS 1.3 that discards the client's Finished.
- **Fix:** `end()` sends Finished and close_notify (TLS records, not IMAP data), with a 1 s `destroy()` fallback. The wire tests still record 0 bytes of IMAP data.
- **Files modified:** apps/worker/src/imap/capture.ts
- **Commit:** 87f571f

**3. [Rule 2 - Missing critical] ImapFlow sends ID before STARTTLS**
- **Found during:** Task 1, while reading imapflow's `startSession`. Confirmed by Task 3's Bridge-greeting wire case, which fails when the guard is removed.
- **Issue:** the plan expected that removing clientInfo would stop the plaintext ID. It does not: ImapFlow always merges its default clientInfo and sends ID whenever the server advertises it.
- **Fix:** `guardPlaintext` wraps `client.run` on every client openImap creates, including injected ones. ID is sent again after login, over TLS. The plan's fake greeting does not advertise ID, so I added a case with Bridge's capability list. This makes the test stricter.
- **Files modified:** apps/worker/src/imap/connect.ts, apps/worker/test/imap-connect.test.ts
- **Commit:** 9dc3855 (guard), 6b8e3bc (test)

**Total deviations:** 3 auto-fixed (2 bugs, 1 missing critical). **Impact:** every plan truth holds as written. The fixes make the fail-closed path correct for EC certificates and keep the plaintext phase down to protocol negotiation.

## TDD Gate Compliance

`workflow.tdd_mode` is false. Task 1 (the tracer) wrote capture.ts and connect.ts before the Task 2 and 3 tests existed, as the plan's task order requires. Each TDD task still has a real RED: `a2e4077` failed on `upgraded` (2 tests), and `6b8e3bc` failed on the EC pin and the login-connection upgrade (3 tests). Each was followed by a fix commit that turned it GREEN. The GREEN commits are typed `fix`, not `feat`, because they correct code that already existed.

## Issues Encountered

- The full suite passed 3 times in a row (36 files, 630 tests), so the known intermittent failure did not show up and I could not identify it.
- `pnpm lint` reports one warning that predates this plan (`noTemplateCurlyInString` in apps/worker/test/node-version.test.ts:26). It exits 0, and I left it alone.

## Verification

- `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/imap-connect.test.ts apps/worker/test/imap-capture.test.ts apps/worker/test/imap-pin.test.ts`: 55 passed
- `pnpm lint` exits 0 and `pnpm typecheck` exits 0
- `pnpm test`: 630 passed, 3 runs out of 3
- Acceptance greps:
  - `doSTARTTLS: true` appears once
  - connect.ts references `capturePeerCertificate`
  - capture.ts cites `D-80`
  - the verification-off grep lists only capture.ts
  - `LOGIN|AUTHENTICATE` count in capture.ts is 0
  - no fs import in capture.ts or connect.ts
  - connect.ts contains `checkServerIdentity` and `ca: [`

## Next Phase Readiness

openImap and classifyImapError are ready for 02-09, 02-11, 02-13 and 02-16. capturePeerCertificate is ready for `sift bridge trust` (02-15). 02-13 should map the classes to the D-33/D-34 owner text.

## Self-Check: PASSED

- All 5 created files and 2 modified files are present on disk
- Commits 9dc3855, a2e4077, 87f571f, 6b8e3bc and d97d31b are in `git log`
