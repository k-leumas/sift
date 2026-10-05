# Phase 2 External API Coverage

External surfaces: Proton Bridge's IMAP server (gluon) and Bridge's local gRPC frontend. Sift never calls Proton's web API directly. INTEGRATE is the default; every OPT-OUT has a reason.

| capability | decision | reason |
|---|---|---|
| IMAP STARTTLS | INTEGRATE | Required for every login (D-42); the only command the unverified capture connection ever sends (D-80); 02-18 capture.ts and connect.ts |
| IMAP implicit TLS (port 993 style) | INTEGRATE | `imap.tls.mode: implicit` for non-Bridge servers (D-74); 02-18 |
| IMAP LOGIN (AUTH=PLAIN over TLS) | INTEGRATE | Password from password_env, sent only over the login connection after TLS, the pin comparison and that connection's own `ca` plus SPKI verification (D-80); 02-18 |
| IMAP CAPABILITY (pre- and post-auth) | INTEGRATE | The capture reads STARTTLS support from the greeting only and never sends CAPABILITY (D-80); ImapFlow uses it on the login connection; the probe records both sets (SPK-02); 02-18, 02-11 |
| IMAP ID | INTEGRATE | ImapFlow sends `clientInfo: { name: 'Sift' }` only, on the verified login connection; no version or host data; 02-18 |
| IMAP LIST | INTEGRATE | Probe folder summary, label prefixes and delimiter (SPK-01); 02-11 |
| IMAP EXAMINE | INTEGRATE | The only way ingest opens a folder (read-only, D-11); 02-09 |
| IMAP SELECT | INTEGRATE | Only the probe's confirmed label test opens the spike label folder read-write to remove the test copy; 02-11 |
| IMAP STATUS (UIDNEXT, UIDVALIDITY, MESSAGES, HIGHESTMODSEQ) | INTEGRATE | Probe UIDVALIDITY comparisons and HIGHESTMODSEQ check (SPK-02, SPK-04); 02-11 |
| IMAP UID FETCH (INTERNALDATE, RFC822.SIZE, ENVELOPE, BODYSTRUCTURE, BODY.PEEK[HEADER.FIELDS]) | INTEGRATE | Ingest metadata and identity headers, never setting \Seen; 02-09 |
| IMAP UID FETCH BODY.PEEK[part] (download with maxBytes) | INTEGRATE | Bounded text-part download for the body cache (D-06); 02-09 |
| IMAP UID SEARCH (UID range, SINCE) | INTEGRATE | Removal diff, backfill window and CLI backfill count (D-17, D-75); 02-09, 02-10 |
| IMAP IDLE | INTEGRATE | Probe only, to answer whether Bridge's IDLE works (D-27, D-43); the worker polls (disableAutoIdle); 02-11 |
| IMAP ENABLE CONDSTORE / QRESYNC | INTEGRATE | Probe sends it raw and records the answer (SPK-02); the worker does not depend on it, because gluon does not advertise either; 02-11 |
| IMAP UID COPY + UIDPLUS COPYUID | INTEGRATE | Probe label test: apply a label by copying into `Labels/Sift Spike` (SPK-01); 02-11 |
| IMAP STORE \Deleted + UID EXPUNGE | INTEGRATE | Probe label test only, in the spike label folder, to remove the label (SPK-01); 02-11 |
| IMAP CREATE (mailbox) | INTEGRATE | Probe creates `Labels/Sift Spike` once, after typed confirmation; 02-11 |
| IMAP LOGOUT | INTEGRATE | closeImap after every run (never on the capture connection, D-80); 02-18 |
| IMAP MOVE | OPT-OUT | Sift never moves mail (ACT-05); Phase 4 applies labels by COPY, as the spike determines |
| IMAP APPEND | OPT-OUT | Sift never creates mail in the owner's mailbox; tests append to the Dovecot test server only |
| IMAP STORE of user-visible flags (\Seen, \Flagged, keywords) | OPT-OUT | D-11: ingest never changes read state or flags |
| IMAP COMPRESS=DEFLATE | OPT-OUT | Not advertised by gluon; local loopback traffic needs no compression |
| IMAP NAMESPACE / QUOTA / ACL | OPT-OUT | Not needed for reading one folder or for the spike questions |
| Bridge gRPC SetIsTelemetryDisabled / IsTelemetryDisabled | INTEGRATE | Telemetry off and verified at init (PROJECT no-telemetry); 02-08 |
| Bridge gRPC SetIsAutomaticUpdateOn / IsAutomaticUpdateOn | INTEGRATE | Auto-update off and verified at init (D-30); 02-08 |
| Bridge gRPC GetUserList | INTEGRATE | Reads the IMAP password and address mode inside the container only (D-35, D-39); 02-08 |
| Bridge gRPC TriggerRepair | INTEGRATE | Spike-only cache rebuild, behind owner approval (D-43); 02-08, 02-14 |
| Bridge gRPC Quit | INTEGRATE | Clean stop after configure and repair; 02-08 |
| Bridge gRPC ExportTLSCertificates | OPT-OUT | Writes the private key to disk; the certificate is read from the TLS handshake instead and pinned by fingerprint in config (D-73) |
| Bridge gRPC Login / Login2FA / LoginAbort | OPT-OUT | Login runs in Bridge's own CLI, which handles 2FA, FIDO and human verification (D-36, RESEARCH Don't Hand-Roll) |
| Bridge gRPC SetMailServerSettings | OPT-OUT | Default IMAP port 1143 is kept; socat exposes it on the container IP (Pitfall 1) |
| Bridge gRPC CheckUpdate / InstallUpdate | OPT-OUT | Updates come only from the pinned source build and Renovate PRs (D-30, D-31) |
| Bridge gRPC LogoutUser / RemoveUser | OPT-OUT | Owner maintenance through `bridge cli`; not automated by Sift |
| Proton web API (direct) | OPT-OUT | Bridge is the only path to Proton; Sift holds no Proton credentials (D-36) |
