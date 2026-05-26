---
layout: home

hero:
  name: mad-reviewer
  text: AI pull-request review with a memory
  tagline: A self-hosted GitHub App that reviews PRs with a configurable AI tool, posts inline bug comments, and resolves them automatically when the bug is fixed.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /architecture/overview
    - theme: alt
      text: View on GitHub
      link: https://github.com/deniscsz/mad-reviewer

features:
  - title: Reviews that remember
    details: Reconciles against its own past comments every run — keeps open findings, resolves fixed ones with a reply, and re-flags regressions. No duplicate spam.
  - title: GitHub is the source of truth
    details: No findings database. The agent recognizes its own comments by a fingerprint marker embedded in each body. SQLite holds only job orchestration.
  - title: Your skills, your rules
    details: Markdown review skills in three tiers — always-on defaults, glob-selected auto-apply skills, and per-repo overrides committed in the reviewed repo.
  - title: Configurable AI tool
    details: Default is the headless claude CLI; the adapter interface is swappable, so cursor, opencode, or anything else can be added behind the same contract.
  - title: Safe by construction
    details: Every subprocess runs through a single no-shell wrapper with array arguments, so PR-controlled values can never be interpreted by a shell.
  - title: Robust orchestration
    details: Debounced, one run per PR, retries on failure, skips already-processed commits, and reclaims jobs after a crash or restart.
---
