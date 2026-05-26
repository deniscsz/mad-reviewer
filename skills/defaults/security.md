---
name: security
description: Detect common injection and unsafe-input bugs
---

# Security

Look for:
- SQL/command/template injection from unsanitized input.
- Reflected/stored XSS from untrusted data rendered without escaping.
- Path traversal from user-controlled paths.
- Secrets/tokens logged or returned in responses.

Report each as a `security/<kind>` finding with a `dedupeKey` like
`security:<sink>:<source>`.
