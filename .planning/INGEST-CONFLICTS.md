## Conflict Detection Report

### BLOCKERS (0)

(none)

### WARNINGS (0)

(none)

### INFO (1)

[INFO] Auto-resolved: ADR-0001 > README on mailbox scoping of rule sets and eval runs
  Note: /Users/samuel/dev/sift/docs/adr/0001-multiple-mailboxes-single-owner.md (Accepted, locked) lists rule sets and eval runs among the tables that hold mail-derived data and states every such table has a non-null `mailbox_id`. /Users/samuel/dev/sift/README.md (DOC) data model scopes `rule_set` as "`mailbox_id` (or shared)" and `eval_run` as "`mailbox_id` or synthetic", which implies nullable or absent `mailbox_id` for shared rules and synthetic eval runs. ADR wins per precedence (ADR > DOC); intel records the ADR wording. Downstream planning should decide how shared-rules and synthetic-inbox eval runs fit under a non-null `mailbox_id` (for example, shared rules merged at read time from `data/shared-rules.md`, as ADR-0001 item 5 describes), or record a superseding ADR if the intent is to allow nullable scoping.
