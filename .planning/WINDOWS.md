---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-10-10T23:20:08.911Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 03 | unrun-verify | apps/worker/test/support/llm-baseline.ts |  | 03-13 Task 2 human-check: owner runs the live baseline against the real Ollama on synthetic pairs and pastes the table into 03-VERIFICATION | open |  | 2026-10-10T23:20:08.911Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "apps/worker/test/support/llm-baseline.ts",
    "line": null,
    "description": "03-13 Task 2 human-check: owner runs the live baseline against the real Ollama on synthetic pairs and pastes the table into 03-VERIFICATION",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-10T23:20:08.911Z",
    "resolved_at": null,
    "milestone": "v0.1"
  }
]
````
