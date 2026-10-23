---
name: merge-request-review
description: Always completes Step 1 (model check, prompt user when not Claude/GPT) before gathering context. Review merge/pull requests for bugs, memory leaks, security issues, structural problems, and missing verification. Use when the user asks to review a branch, MR, PR, code changes, or wants a code review before merging.
---

# Merge Request Review

Review code changes on the current branch against the base branch, evaluating changes based on the stated intention of the PR (PR description, commit messages, or what the user tells you).

## Hard gate

**Do not** run shell commands, read the diff, call MCP, or open project files for this review until **Step 1** is complete (model identified; user prompted when required per Step 1).

## Workflow

### Step 1: Model selection (Mandatory: DO NOT SKIP)

Finish **all** of the following before starting Step 2.

1. **Identify the model** running this skill (e.g. Composer, Claude, GPT-5.x). You will record it in the saved review as **`Reviewer model:`** (see Output Template).

2. **If the model is not Claude and not GPT** (case-insensitive match on the product or name the user sees, e.g. `claude`, `gpt`):
   - **Preferred:** Use the **AskQuestion** tool with this exact question:
     > **"This skill works best when using claude or gpt, would you like to switch models?"**
   - **If AskQuestion is not available:** Output that question verbatim in your message, then **stop** and wait for the user to answer or to explicitly tell you to continue with the current model. **Do not** proceed to Step 2 until they respond.

3. **If the model is Claude or GPT:** No switch prompt required; still include **`Reviewer model:`** in the final review document.

**Step 1 completion checklist (all must be true):**

- [ ] Model identity is known and will appear as **`Reviewer model:`** in the plan file.
- [ ] Either the model is Claude/GPT, **or** the user has been asked (via AskQuestion or chat) and you have their answer **or** explicit permission to continue without switching.

### Step 2: Gather Context

**Prerequisite:** Step 1 is complete (checklist above).

1. Read `_repo-config.md` in this skill's directory for repository-specific settings (GitHub repo, base branch, script path, verification commands).

2. Get the current branch name:
   ```bash
   git branch --show-current
   ```

3. Determine the intent of the change, in this order:
   - Fetch the open PR for the branch (title + description):
     ```bash
     {pr_review_script} info
     ```
     If the script reports no open PR or fails on auth, continue with the next source.
   - Read the commit messages on the branch:
     ```bash
     git log --oneline <base-branch>..HEAD
     ```
   - If the intent is still unclear, ask the user what the change is supposed to do.

4. Identify the base branch (`base_branch` in `_repo-config.md`, usually `master`). Prefer `origin/<base>` if the local base is stale:
   ```bash
   git fetch origin <base-branch> --quiet
   ```

5. Run diff to see all committed changes on the branch:
   ```bash
   git diff origin/<base-branch>...HEAD
   ```
   Also check `git status --short`. If there are uncommitted changes, ask the user whether to include them (`git diff HEAD`) in the review.

### Step 3: Analyze Changes

Review each changed file for issues in these categories:

| Category | What to Look For |
|----------|------------------|
| **Bugs** | Logic errors, null/undefined access, unhandled promise rejections, race conditions between async calls, incorrect error handling |
| **Memory Leaks** | Event listeners never removed, un-revoked object URLs, intervals/timeouts/animation frames never cleared, growing caches, detached DOM nodes |
| **Security** | Secrets in the client bundle, XSS via `innerHTML`, token handling, CORS/origin checks, unvalidated input (imports, URL params, API responses) |
| **Structure** | God functions, poor separation of concerns, duplication, violation of existing project patterns |
| **Tests / Verification** | No automated test suite exists in this repo -- check the change type-checks and builds, and list the manual test steps needed to verify it |

**Language/Technology Checklists:**

Use the Glob tool to find all `*-mr-review.md` files in this skill's directory. Read **every** match -- each contains a stack-specific review checklist. Apply a checklist only when the diff touches files it covers. If no checklist files are found, review using the general categories above only.

**Verification:**

Run the `verify_commands` from `_repo-config.md` (type check / build). Report any errors introduced by the branch as findings. If a command fails for reasons unrelated to the diff (e.g. missing env vars), note it in the review rather than treating it as a finding.

### Step 4: Provide Review Summary and Save to Plans

Format findings using these severity levels (use the Output Template below):

- **CRITICAL**: Must fix before merge. Security vulnerabilities, leaked secrets, data loss (e.g. IndexedDB/localStorage corruption), crashes, broken auth flow.
- **WARNING**: Should fix. Bugs, leaks, potential issues, significant code quality problems.
- **INFO**: Consider fixing. Style improvements, minor optimizations, suggestions.

## Output Template

```markdown
# MR Review: [Branch Name]

**Reviewer model:** [e.g. Composer (Cursor), Claude Opus, GPT-5.x]
**Base:** [base branch] | **PR:** [PR link, or "none found"]

## Summary
[One paragraph describing what the change does and overall assessment]

## Findings

### CRITICAL
- [File:Line] Description of critical issue
  - Why it's critical
  - Suggested fix

### WARNING
- [File:Line] Description of warning
  - Impact
  - Suggested fix

### INFO
- [File:Line] Description of suggestion
  - Rationale

## Verification
- [ ] `npm run build` (tsc + vite build) passes
- [ ] Manual test steps:
  1. [Step that exercises the changed behavior]
  2. [Edge case to try]

## Verdict
[APPROVE / REQUEST CHANGES / NEEDS DISCUSSION]
```

**Always save the review to `.cursor/plans`.** Use the Write tool to create `.cursor/plans/mr-review-{branch}.plan.md` (sanitize the branch name: replace `/` and spaces with `-`). If a review for this branch already exists, write `.cursor/plans/mr-review-{branch}-round{N}.plan.md` instead of overwriting it.

### Step 5: Offer to Post to the GitHub PR (Mandatory Ask)

**Always** after saving the review plan, use the AskQuestion tool to ask:

> **"Should this review be posted to the pull request on GitHub?"**

- Options: "Yes, post to GitHub" / "No, skip"
- **Do not skip this step** -- you must invoke AskQuestion. Do not merely mention it in the output.
- Applies regardless of format (plan mode, markdown, or inline).

If the user chooses to post:
1. Use the `pr_review_script` path from `_repo-config.md` (defaults to `scripts/pr-review.sh`).
2. Run: `{pr_review_script} post .cursor/plans/{saved-filename}.md` (use the same filename you wrote in Step 4). This needs network access.
3. The script looks up the PR number from the current branch via the GitHub API (no manual PR number needed).
4. Confirm success (the script prints the comment URL) or report any error.

The script uses `GITHUB_TOKEN` / `GH_TOKEN` when set, and otherwise falls back to the git credential helper for `github.com`.

## Quick Commands

```bash
# View all changed files
git diff --name-only origin/master...HEAD

# View diff for a specific file
git diff origin/master...HEAD -- path/to/file.ts

# Changed browser code vs. worker code
git diff --name-only origin/master...HEAD | grep -E '^src/'
git diff --name-only origin/master...HEAD | grep -E '^workers/|^wrangler\.toml$'

# Changed config / env / CI
git diff --name-only origin/master...HEAD | grep -E '(^\.env|^\.github/|vite\.config|tsconfig|package\.json)'

# New innerHTML / listener / object URL usage introduced by the branch
git diff origin/master...HEAD | grep -E '^\+.*(innerHTML|addEventListener|createObjectURL|setInterval|import\.meta\.env)'
```
