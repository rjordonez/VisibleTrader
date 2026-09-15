# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, etc.) working in this repo.

## PR Guidelines

- When opening a PR (into `develop` or `main`) that ships a user-facing change, include a `## Product Update` section in the PR body. This gets posted to the team's marketing Discord channel on merge to `main`.
- Audience: non-technical marketers/UGC creators. Write 1-3 plain-English sentences describing what changed for the user. No implementation detail, no jargon — no file names, function names, library names, or internal system names.
- Omit the `## Product Update` section entirely for internal/dev-only changes (refactors, tests, infra, bug fixes with no visible behavior change). Don't force boilerplate if there's nothing to announce.
- When opening a `develop`→`main` PR specifically, run `scripts/pr_rollup.sh` first and use its output as the PR's `## Product Update` section — it gathers the accumulated sections from the individual PRs merged into `develop` since the last `main` update. If the script prints nothing, omit the heading.
