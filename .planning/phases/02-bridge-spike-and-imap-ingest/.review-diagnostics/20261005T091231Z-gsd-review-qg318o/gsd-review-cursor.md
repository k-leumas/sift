cursor review failed or returned empty output. stderr:
Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.

Diagnosis: cursor ran with no effort argument, so the reviewer CLI's own configuration applied and exited with status 1.
