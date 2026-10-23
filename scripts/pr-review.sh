#!/bin/bash
# Look up / comment on the GitHub pull request for the current branch.
# Usage:
#   ./scripts/pr-review.sh info [PR_NUMBER]               Print the PR number, URL, title, and description
#   ./scripts/pr-review.sh post [review_file] [PR_NUMBER] Post review markdown as a PR comment (default: stdin)
#
# Requires: curl, jq. Auth via GITHUB_TOKEN or GH_TOKEN; falls back to the git
# credential helper (e.g. osxkeychain) for github.com when neither is set.
# Example: ./scripts/pr-review.sh post .cursor/plans/mr-review-my-branch.plan.md

set -euo pipefail

MODE="${1:-}"
if [ "$MODE" != "info" ] && [ "$MODE" != "post" ]; then
  echo "Usage: $0 info [PR_NUMBER] | $0 post [review_file] [PR_NUMBER]" >&2
  exit 1
fi

if [ "$MODE" = "info" ]; then
  REVIEW_FILE=""
  PR_NUMBER="${2:-}"
else
  REVIEW_FILE="${2:-}"
  PR_NUMBER="${3:-}"
fi

GITHUB_API="${GITHUB_API:-https://api.github.com}"
REPOSITORY="${GITHUB_REPOSITORY:-$(git remote get-url origin 2>/dev/null | sed -E 's|.*github\.com[:/]([^/]+/[^/]+)$|\1|; s|\.git$||')}"
REPOSITORY="${REPOSITORY:-matyaskrizek/spotifyQueue}"
OWNER="${REPOSITORY%%/*}"

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2- || true)
fi
if [ -z "$TOKEN" ]; then
  echo "Error: GITHUB_TOKEN or GH_TOKEN required, or run 'git fetch' so the credential helper has a github.com token" >&2
  exit 1
fi

api() {
  curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

if [ -n "$PR_NUMBER" ]; then
  PR_JSON=$(api "${GITHUB_API}/repos/${REPOSITORY}/pulls/${PR_NUMBER}")
else
  BRANCH=$(git branch --show-current 2>/dev/null)
  if [ -z "$BRANCH" ]; then
    echo "Error: Cannot determine branch. Pass the PR number explicitly." >&2
    exit 1
  fi
  PR_JSON=$(api "${GITHUB_API}/repos/${REPOSITORY}/pulls?head=${OWNER}:${BRANCH}&state=open&per_page=1" \
    | jq 'if type == "array" and length > 0 then .[0] else empty end')
  if [ -z "$PR_JSON" ]; then
    echo "Error: No open pull request found for branch '${BRANCH}'. Pass the PR number explicitly." >&2
    exit 1
  fi
fi

PR_NUMBER=$(echo "$PR_JSON" | jq -r '.number')

if [ "$MODE" = "info" ]; then
  echo "$PR_JSON" | jq -r '"PR #\(.number): \(.title)\nURL: \(.html_url)\nBase: \(.base.ref) <- Head: \(.head.ref)\n\n\(.body // "(no description)")"'
  exit 0
fi

if [ -n "$REVIEW_FILE" ]; then
  BODY=$(cat "$REVIEW_FILE")
else
  BODY=$(cat)
fi

# Strip YAML frontmatter (--- ... ---) from .plan.md files
BODY=$(echo "$BODY" | awk 'NR==1 && /^---$/ { skip=1; next } skip && /^---$/ { skip=0; next } skip { next } { print }')

echo "Posting to PR #${PR_NUMBER}" >&2
api -X POST \
  "${GITHUB_API}/repos/${REPOSITORY}/issues/${PR_NUMBER}/comments" \
  -d "$(jq -n --arg body "$BODY" '{body: $body}')" \
  | jq -r '"Posted: \(.html_url)"'
