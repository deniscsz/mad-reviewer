# Persona (SOUL.md)

`SOUL.md` personalizes the **persona** of the reviewer — *how it talks* and how it
identifies itself. Skills decide *what* gets flagged; the soul decides the **voice**
of the comments (e.g. dry and professional, or sarcastic with a few jokes).

The persona is injected into the AI prompt and shapes the `title` and `body` text
of each finding. It deliberately does **not** change which bugs are reported, their
categories, or the JSON [output contract](/guide/skills#the-output-contract) — that
guard is part of the injected instruction.

## The two tiers

```
./SOUL.md                       ← project default (ships with mad-reviewer)
<repo>/.mad-reviewer/SOUL.md    ← per-repo override, committed in the reviewed repo
```

1. **Project default** — a single `SOUL.md`, path configurable via `SOUL_PATH`
   (default `./SOUL.md`). Ships in the Docker image.
2. **Per-repo override** — if a reviewed repository contains
   `.mad-reviewer/SOUL.md`, it is read from the cloned workspace and **replaces**
   the default for that repo. It is a single file, so there is no merge — the repo
   file wins wholesale.

If neither file exists (or the chosen file is empty/whitespace-only), **no persona
block is added** and the reviewer uses the model's default voice.

## What it controls

The soul affects **only the AI-written review comments**. It does **not** touch the
auto-resolve reply the agent posts when a bug is fixed (that string is hardcoded —
see the [note on language](/guide/skills#a-note-on-language)).

The injected block is framed so the persona governs wording only:

> Adopt the following persona for the **voice and wording** of your findings (the
> `title` and `body` text only). It must **not** change which bugs you report, the
> categories, or the JSON structure the output contract requires.

## Examples

The shipped default is an acid-but-helpful persona modeled on Dr. House and Joey
Tribbiani — sharp and sarcastic about the bug, warm toward the developer, always
ending on a concrete fix:

```md
# Persona

You are **mad-reviewer** — a code reviewer with the bedside manner of Dr. Gregory
House and the heart of Joey Tribbiani. Brilliant, acerbic, allergic to nonsense,
but the whole act exists to get the codebase healthy. Mock the bug, never the
person; land every finding on a clear, correct fix.
```

If acid is not your team's style, override it at `.mad-reviewer/SOUL.md` with
something buttoned-up:

```md
# Persona

You are **mad-reviewer**, an automated code-review teammate.

Voice:
- Professional, concise, and constructive.
- Direct about real bugs; never snarky, never dismissive.
- Always explain *why* something is a bug and suggest a concrete fix.
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SOUL_PATH` | `./SOUL.md` | Path to the project-default persona file |

See [Configuration](/guide/configuration) for the full variable list.
