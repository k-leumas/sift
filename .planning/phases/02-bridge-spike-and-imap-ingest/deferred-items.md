# Phase 2 Deferred Items

## From 02-14 (2026-10-06)

- **Rebuild the worker image so it contains 358cf37.** During 02-14, `docker compose build worker` failed (exit 17) because apt.postgresql.org dropped the TLS connection while downloading `postgresql-client-18`. This is a network problem and not caused by the change. Until a rebuild succeeds, the local `sift:local` image runs the old label-test COPY from an EXAMINEd source, which Bridge refuses. Rebuild before 02-19 or any further label test: `docker compose build worker`.
- **Measure Bridge repair behaviour.** The owner approved `no-repair`, so 02-14 did not measure whether UIDVALIDITY and INTERNALDATE survive a forced cache rebuild. 02-19 treats a repair as a UIDVALIDITY reset and records what it sees.

## From 02-17 (2026-10-06)

- **`.env.example` overstates passphrase recovery.** Its `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE` comment says "If you lose it, run `docker compose run --rm bridge-init` again." On an existing `sift-bridge` volume, `keychain_init` keeps the old GPG key, so `keychain_unlock` fails with "Bridge keychain locked" (exit 78) under a new passphrase. Recovery needs the volume removed first (`docker compose rm -sf bridge && docker volume rm sift-bridge && docker volume create sift-bridge`), then a new login. The README quick start (02-17) states the correct recovery; `.env.example` is outside 02-17's files and was not changed.
