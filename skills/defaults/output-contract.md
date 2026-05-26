---
name: output-contract
description: Defines the exact JSON output every review must emit
---

# Output contract

After analyzing the PR, output **only** a JSON array (no prose). Each element is
one bug:

```json
[
  {
    "file": "relative/path/from/repo/root.ts",
    "line": 42,
    "category": "null-safety",
    "dedupeKey": "null-safety:UserService.load:user-param",
    "severity": "bug",
    "title": "Short one-line summary",
    "body": "Explanation of the bug and a concrete suggested fix."
  }
]
```

Rules:
- `severity` is always `"bug"`. Do not report style or nitpicks.
- `dedupeKey` must be a STABLE semantic identity in the form
  `<category>:<symbol-or-scope>:<symptom>`. It must NOT contain line numbers and
  must stay identical across runs for the same underlying bug, even if the code
  moves lines.
- `line` is the line in the PR head where the bug occurs.
- If there are no bugs, output `[]`.
