---
phase: 02-bridge-spike-and-imap-ingest
review: 02-REVIEW.md
recorded: 2026-10-06
---

# Phase 02 review disposition

| ID | Severity | Summary | Disposition |
|----|----------|---------|-------------|
| CR-01 | critical | Array match binds one param per id; >65,535 live locations makes finishResync fail forever | fixed |
| CR-02 | critical | .env.mailboxes keeps host mode on in-place write; may be world-readable (D-39 wants 0600) | fixed |
| WR-01 | warning | storedError/codedCause fallback can carry Drizzle "params:" text into last_error/logs | fixed |
| WR-02 | warning | backfill confirmation prompt holds IMAP connection + ingest lock; idle timeout after 120 s | fixed |
| WR-03 | warning | INTERNALDATE watermark has no upper bound; one future-dated message makes later mail historical | fixed (needs human check) |
| WR-04 | warning | trustPmHeader is always true; forgeable X-Pm-Internal-Id trusted on any server | fixed (needs human check) |
| WR-05 | warning | expired pinned cert: worker says pin mismatch, bridge trust says match | fixed |
| WR-06 | warning | backfill progress can stay "backfilling X of Y" after a resync drops the first backfill | fixed |
| IN-01 | info | cause-chain helper duplicated in four places | open |
| IN-02 | info | missing UIDNEXT yields NaN UIDs | open |
| IN-03 | info | volume hold also pauses the first backfill (D-75 wording) | open |
| IN-04 | info | valve counts CLI-backfilled mail above last_uid as new | open |
