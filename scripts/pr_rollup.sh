#!/usr/bin/env bash
# Gathers the "## Product Update" sections from PRs merged into `develop`
# since `main` was last updated, and prints a combined "## Product Update"
# block for a develop->main PR body. Prints nothing if none of the
# underlying PRs had a section.
#
# Requires: git, gh (authenticated), run from within the repo.

set -euo pipefail

BASE_BRANCH="${1:-main}"
HEAD_BRANCH="${2:-develop}"

extract_section() {
  awk '
    /^## Product Update[[:space:]]*$/ { capture=1; next }
    /^## / { if (capture) exit }
    capture { print }
  ' | sed -e '/./,$!d' -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
}

pr_numbers=$(git log "${BASE_BRANCH}..${HEAD_BRANCH}" --merges --oneline \
  | { grep -oE '#[0-9]+' || true; } \
  | tr -d '#' \
  | sed '1!G;h;$!d')

sections=()
for pr in $pr_numbers; do
  body=$(gh pr view "$pr" --json body -q .body 2>/dev/null || true)
  [ -z "$body" ] && continue

  section=$(printf '%s\n' "$body" | extract_section)
  [ -z "$section" ] && continue

  sections+=("- $section")
done

if [ "${#sections[@]}" -eq 0 ]; then
  exit 0
fi

echo "## Product Update"
printf '%s\n' "${sections[@]}"
