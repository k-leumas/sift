# Phase 2: Bridge Spike and IMAP Ingest - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-05
**Phase:** 02-bridge-spike-and-imap-ingest
**Areas discussed:** Backfill & stored content; Identity, dedup & resync; Bridge connection & TLS
**Not selected:** Spike method & findings (left to Claude). A second round (spike method & safety, CLI surface, ingest observability) was offered; the owner skipped the picker and said "continue", so these are recorded as Claude's discretion.

---

## Backfill & stored content

### First-sync backfill
| Option | Description | Selected |
|--------|-------------|----------|
| Bounded window | Last N days on first sync, then new | (opt-in) |
| Only new mail | Start at UIDNEXT | ✓ (default) |
| Full history | Everything in the folder | |

**User's choice:** "option 1 for testing out configurations, N defaults to 3, but the default is option 2".

### How the opt-in works
| Option | Description | Selected |
|--------|-------------|----------|
| Per-mailbox config key | Declarative, persistent | |
| CLI flag, one-shot | `--backfill-days`, default 3 | |
| Both | Config key + CLI one-shot | ✓ |

### Body content
| Option | Description | Selected |
|--------|-------------|----------|
| Text, truncated | text/plain or HTML→text, cap, attachment metadata | ✓ |
| Text + raw RFC822 | Keep full raw message | |
| Headers + snippet only | ~2 KB text | |

### Headers
| Option | Description | Selected |
|--------|-------------|----------|
| Curated set | From/To/…/List-Id typed or JSONB | |
| All headers as JSONB | Everything | |
| You decide | Must cover rules + identity fallback | ✓ |

### Batching
| Option | Description | Selected |
|--------|-------------|----------|
| Chunked, commit per chunk | Resumable, shutdown between chunks | ✓ |
| Capped per run | N per poll | |
| You decide | | |

### Read state
| Option | Description | Selected |
|--------|-------------|----------|
| Never change it | BODY.PEEK, flags-unchanged test | ✓ |
| Record it, never change it | Also store \Seen/\Flagged | |

### backfill_days changed later
| Option | Description | Selected |
|--------|-------------|----------|
| First sync only | CLI one-shot for more | ✓ |
| Extend on change | Fetch the older missing mail | |

### Body retention
| Option | Description | Selected |
|--------|-------------|----------|
| Keep, decide later | Tie to ADR-0003 prompt retention | |
| Drop body after classification | Headers/metadata only | |

**User's choice (free text):** Don't store bodies permanently; IMAP is the source of truth. Short-lived processing cache until classified + 7 days, then delete. Keep embeddings, labels, metadata. Tier-2 examples, replay and evals refetch by Message-ID; deleted mail drops out. Traces store the prompt recipe, not raw prompts (resolves ADR-0003's item). Document full-disk encryption; no column-level encryption.

### Never-classified cached bodies
| Option | Description | Selected |
|--------|-------------|----------|
| Keep until classified, then 7d | Separate scoped cache table, sweep | ✓ |
| Hard cap regardless | e.g. 30 days since ingest | |
| No cache, always refetch | | |

---

## Identity, dedup & resync

### Dedup key
| Option | Description | Selected |
|--------|-------------|----------|
| Stable identity key | Message-ID or header hash; location separate | ✓ |
| Folder + UIDVALIDITY + UID | IMAP-native | |
| Defer to spike result | | |

**Notes:** Prefix keys `mid:` / `hdr:` (and `pm:` if the spike finds a stable Proton internal ID); a conflict is "same message" (upsert adding a location), and the spike counts real collisions (add a Date tiebreaker if meaningful); conservative normalisation (strip brackets/whitespace, lowercase domain only); `message_location` table with `UNIQUE (mailbox_id, folder, uidvalidity, uid)`; resync replaces a folder's location rows and leaves messages, labels and decisions untouched.

### Folders scanned
| Option | Description | Selected |
|--------|-------------|----------|
| Configured folder only | Label folders from Phase 4 / M2 | ✓ |
| Folder + Sift label folders | Relabel groundwork now | |

### Removed mail
| Option | Description | Selected |
|--------|-------------|----------|
| Mark location gone | `removed_at`, VANISHED or UID diff | ✓ |
| Ignore removals in M1 | | |

### UIDVALIDITY resync
| Option | Description | Selected |
|--------|-------------|----------|
| Headers-only rescan | Upsert locations, nothing reclassified | ✓ |
| You decide | | |

**Notes:** "New" is decided by the watermark, not by whether the key is known (unknown+older = location only, not classified; known but missing = `removed_at`). All-or-nothing via a generation number, FETCH batches of ~500, supersede in one final transaction, folder marked resyncing (actions paused), retry from the start on failure. Log and persist the counts summary.

### Body of a removed, unclassified message
| Option | Description | Selected |
|--------|-------------|----------|
| Delete on removal | | ✓ |
| Keep, 7 days from removal | | |

### Watermark
| Option | Description | Selected |
|--------|-------------|----------|
| INTERNALDATE + UID | Not sender-forgeable | ✓ |
| Date header | | |

**Notes:** The spike must verify INTERNALDATE survives a reset. 5-minute overlap + identity dedup at the boundary. Mail moved back keeps its old date and is not classified (intended). Safety valve: >200 (configurable) new in a cycle → `needs_attention`, `sift mailbox resume <slug>`.

### IDLE
| Option | Description | Selected |
|--------|-------------|----------|
| Polling only | One code path | ✓ |
| IDLE + polling fallback | | |

**Notes:** Add a scheduler `nudge(mailboxId)` keeping no-overlap; used later by IDLE or `sift mailbox sync <slug>`.

---

## Bridge connection & TLS

### Where Bridge runs
| Option | Description | Selected |
|--------|-------------|----------|
| Host app + relay | Official app, socat relay | |
| Bridge in Compose | Headless container on the Compose network | ✓ |
| Support both, document one | | |

**Notes:** `ports: ["127.0.0.1:1143:1143"]`, reachable from the Mac, not the network.

### Bridge image
| Option | Description | Selected |
|--------|-------------|----------|
| Own Dockerfile | Official package, pinned, verified | ✓ (modified) |
| Community image | | |

**Notes:** Build from source (`ProtonMail/proton-bridge`), self-update off, Renovate bumps tag + SHA together.

### TLS trust
| Option | Description | Selected |
|--------|-------------|----------|
| Pin exported cert | Fail closed on mismatch | ✓ |
| Trust on first use | | |
| Skip verification | | |

**Notes:** SPKI pin with a custom `checkServerIdentity` that ignores the hostname; init exports the cert to a shared volume (worker read-only); a changed cert fails closed and points at `sift bridge trust`; STARTTLS required with no plaintext fallback, with a fake-server test.

### Bridge login and vault
| Option | Description | Selected |
|--------|-------------|----------|
| Interactive init + volume | `bridge init`, `sift-bridge` volume | ✓ |
| You decide | | |

**Notes:** The vault holds session tokens (as sensitive as the password): the volume is `external: true` and excluded from backups. GPG key passphrase from `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE`, given to Bridge only. Asked for the IMAP password to be written to `.env.mailboxes` automatically, never shown in the terminal; Claude confirmed it is feasible (capture in the container, upsert by `password_env`, 0600, backup, research the gRPC extraction route).

### Worker ↔ Bridge dependency
| Option | Description | Selected |
|--------|-------------|----------|
| Soft dependency | Per-mailbox errors | ✓ |
| Hard depends_on healthy | | |

**Notes:** Visibility-only TCP healthcheck, `restart: unless-stopped`, a `connecting` state during a startup grace period (~1 min / first attempts).

### Address mode
| Option | Description | Selected |
|--------|-------------|----------|
| Let the spike decide | | |
| Combined, one Sift mailbox | | ✓ |
| Split mode | | |

---

## Claude's Discretion

- Stored header set
- Spike method (scripted, repeatable, bounded mailbox changes approved at run time)
- CLI surface and naming
- Ingest observability (`sift mailbox list` columns, log lines)
- IMAP library, chunk/cap sizes, sweep cadence, grace length, column names

## Deferred Ideas

- IMAP IDLE via `nudge()`
- Polling label folders / relabel learning (M2)
- Split address mode (M5)
- Column-level encryption
- Owner-generated cert imported into Bridge
