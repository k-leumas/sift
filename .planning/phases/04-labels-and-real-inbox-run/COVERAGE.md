# API Coverage — IMAP on Proton Bridge v3.27.0 (label writes), plus the Ollama transport

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Integration: plans 04-02 (write gate and command allowlist), 04-09 and 04-10 (apply executor), 04-03 and 04-06 (Ollama reached through the models-egress relay). Reads that ingest already used (FETCH, STATUS, LOGIN, STARTTLS) are unchanged from Phase 2.

| capability | decision | reason |
|---|---|---|
| LIST (find `Labels/<name>` folders, case rule D-11/D-12) | INTEGRATE | |
| EXAMINE (every read, label folders included) | INTEGRATE | |
| SELECT (read-write, only around a COPY or a removal) | INTEGRATE | |
| CREATE `Labels/<name>` on first use (D-10) | INTEGRATE | |
| UID COPY into `Labels/<name>` with COPYUID (UIDPLUS) | INTEGRATE | |
| UID SEARCH HEADER X-Pm-Internal-Id / Message-ID (presence check, D-16) | INTEGRATE | |
| UID SEARCH UID (source liveness after an unconfirmed COPY, Pitfall 5) | INTEGRATE | |
| UID FETCH BODY.PEEK[HEADER.FIELDS] (exact identity check) | INTEGRATE | |
| UID STORE +FLAGS (\Deleted) on Sift's own recorded copy in a label folder | INTEGRATE | |
| UID EXPUNGE of that one copy UID (UIDPLUS) | INTEGRATE | |
| SUBSCRIBE / UNSUBSCRIBE | OPT-OUT | explicitly out of scope: D-28 allows CREATE only; subscription is an IMAP-client view, Proton shows the label without it (re-checked in the live run) |
| CLOSE | OPT-OUT | explicitly out of scope: implicit expunge of every \Deleted message, the owner's included (ACT-05) |
| EXPUNGE (plain) | OPT-OUT | explicitly out of scope: removes every \Deleted message in the folder; only UID EXPUNGE of a recorded copy is allowed (D-28) |
| COPY / STORE by sequence number | OPT-OUT | not needed: UIDs are the only stable handle across sessions; sequence numbers shift |
| MOVE / UID MOVE | OPT-OUT | explicitly out of scope: moving mail out of the inbox modifies the owner's mailbox (ACT-05) |
| APPEND | OPT-OUT | explicitly out of scope: Sift never writes message content, and nothing from a trace enters the mailbox (TRC-05, D-27) |
| DELETE / RENAME mailbox | OPT-OUT | explicitly out of scope: Sift never deletes or renames folders, labels included (ACT-05) |
| STORE of other flags or keywords (\Seen, \Flagged, $keywords) | OPT-OUT | explicitly out of scope: changes message state and would leak decisions into the mailbox (D-27, ACT-05) |
| SETMETADATA / ANNOTATE | OPT-OUT | explicitly out of scope: no trace or decision data is written into the mailbox (D-27) |
| CONDSTORE / QRESYNC change tracking | OPT-OUT | not available: Bridge v3.27.0 does not support them (02-SPIKE-FINDINGS); M2 relabel detection polls instead |
| IDLE for label folders | OPT-OUT | not needed: the label step runs on the worker's poll tick; label-folder watching is M2 relabel detection |
| SMTP submission | OPT-OUT | explicitly out of scope: Sift never sends mail (ACT-05); CI rejects mail-sending dependencies (04-03) |
| Proton API (Bridge's upstream) | OPT-OUT | not needed: Sift never calls it; Bridge reaches it from its own default network |
| Ollama REST API through the models-egress relay | INTEGRATE | same endpoints and decisions as Phase 3 (03 COVERAGE.md); only the host the worker dials changes (SIFT_MODELS_RELAY_HOST, D-29) |
