# Phase 2 Deferred Items

## From 02-14 (2026-10-06)

- **Rebuild the worker image so it contains 358cf37.** During 02-14, `docker compose build worker` failed (exit 17) because apt.postgresql.org dropped the TLS connection while downloading `postgresql-client-18`. This is a network problem and not caused by the change. Until a rebuild succeeds, the local `sift:local` image runs the old label-test COPY from an EXAMINEd source, which Bridge refuses. Rebuild before 02-19 or any further label test: `docker compose build worker`.
- **Measure Bridge repair behaviour.** The owner approved `no-repair`, so 02-14 did not measure whether UIDVALIDITY and INTERNALDATE survive a forced cache rebuild. 02-19 treats a repair as a UIDVALIDITY reset and records what it sees.
