---
name: sql-migrations
description: Extra checks for SQL and migration files
applies_to:
  - "**/*.sql"
  - "**/migrations/**"
---

# SQL & migrations

Look for:
- Destructive migrations (DROP/ALTER) without a safe rollback path.
- Missing indexes on columns used in new WHERE/JOIN clauses.
- Non-idempotent migrations that fail on re-run.

Report as a `sql/<kind>` finding with a `dedupeKey` like `sql:<table>:<issue>`.
