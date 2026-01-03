---
title: Pull Requests
domain: pull-requests
---

# Pull Requests

## Overview

Pull Requests (PRs) connect work tickets to code changes in Git repositories. PRs are created via the GitHub CLI (`gh`) and linked to tickets for traceability. The system supports auto-detection of ticket IDs from branch names and generates PR titles/bodies from ticket information.

## Abilities

| Ability | Description | storage | cli | lib |
|---------|-------------|---------|-----|-----|
| Create PR | Create a GitHub pull request from the current branch | - | `prlt pr create [ticketId]` | `createPR(options)` |
| Link PR | Link an existing GitHub pull request to a ticket | `updateTicket()` | `prlt pr link [ticketId]` | - |
| View PR status | View PR status for a ticket | - | `prlt pr status [ticketId]` | `getPRByNumber(number)` |
| Get PR Feedback | Fetch reviews, comments, and review decision from a PR | - | - | `getPRFeedback()`, `hasPendingFeedback()`, `formatPRFeedbackForPrompt()` |

### CLI Flags

**Create PR** (`prlt pr create`):
- `--base`, `-b`: Base branch for the PR (defaults to main/master)
- `--draft`, `-d`: Create as draft PR
- `--no-link`: Skip linking PR to ticket
- `--title`, `-t`: PR title (auto-generated from ticket if not provided)
- `--body`: PR body/description

**Link PR** (`prlt pr link`):
- `--pr`, `-p`: PR number to link
- `--url`, `-u`: PR URL to link

### PR Feedback Details

Get PR Feedback returns structured feedback including:
- Reviews with state (APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING, DISMISSED)
- Review comments (inline code comments)
- PR-level comments
- Overall review decision

## Data Model

### Ticket Metadata (PR fields)

PR information is stored in the `pmo_ticket_metadata` table as key-value pairs.

| Key | Type | Description |
|-----|------|-------------|
| `pr_url` | string | Full GitHub PR URL |
| `pr_number` | string | PR number as string |
| `pr_branch` | string | Head branch name |

### PR Info (from GitHub API)

| Field | Type | Description |
|-------|------|-------------|
| number | number | PR number |
| url | string | Full PR URL |
| title | string | PR title |
| state | enum | OPEN, CLOSED, MERGED |
| headBranch | string | Source branch |
| baseBranch | string | Target branch |
| isDraft | boolean | Whether PR is a draft |
| createdAt | timestamp | When PR was created |
| updatedAt | timestamp | When PR was last updated |

### PR Feedback

| Field | Type | Description |
|-------|------|-------------|
| prNumber | number | PR number |
| prUrl | string | Full PR URL |
| prTitle | string | PR title |
| reviews | PRReview[] | Review submissions |
| comments | PRComment[] | PR-level comments |
| reviewDecision | enum | APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, null |

### PR Review

| Field | Type | Description |
|-------|------|-------------|
| id | string | Review ID |
| author | string | Reviewer username |
| state | enum | APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING, DISMISSED |
| body | string | Review body text |
| createdAt | timestamp | When review was submitted |
| comments | PRComment[] | Inline code comments in this review |

### PR Comment

| Field | Type | Description |
|-------|------|-------------|
| id | string | Comment ID |
| author | string | Commenter username |
| body | string | Comment text |
| createdAt | timestamp | When comment was posted |
| path | string? | File path (for inline comments) |
| line | number? | Line number (for inline comments) |
| diffHunk | string? | Code context (for inline comments) |

## Business Rules

- **GitHub CLI required**: PR operations require the `gh` CLI to be installed and authenticated
- **Auto-detect ticket ID**: When creating a PR, ticket ID is auto-detected from branch name if matches pattern `TKT-XXX`
- **Auto-generate PR content**: PR title and body are auto-generated from ticket information when not provided
- **Branch must be pushed**: Branches are automatically pushed to origin before creating PR
- **One PR per branch**: If a PR already exists for the current branch, creation is skipped with info displayed
- **PR metadata stored**: PR URL and number are stored in ticket metadata for tracking

## PR Title/Body Generation

### Title Format

```
{TICKET-ID}: {Ticket Title}
```

Example: `TKT-001: Add user authentication`

### Body Template

```markdown
## Summary

Resolves {TICKET-ID}: {Ticket Title}

## Description

{Ticket Description}

## Changes

- {commit 1}
- {commit 2}
- ...

## Test Plan

- [ ] Tests pass locally
- [ ] Manual testing completed
```

## Integration with Work Commands

The PR system integrates with the work lifecycle:

1. `work start` - Creates branch for ticket, prompts for PR creation preference
2. (Agent works on ticket)
3. `work ready` - Triggers PR creation (based on preference from step 1)
4. Human reviews PR, leaves feedback
5. `work revise` - Spawns agent to address PR feedback (if changes requested)
6. `work complete` - Ticket moves to Done

### PR Creation Flow

When starting work (`prlt work start`), the user is prompted whether to create a PR when work is ready. This preference is stored in the execution context and passed to the agent.

When the agent calls `prlt work ready`:
1. Push all commits to origin
2. Create PR (if preference is yes)
3. Link PR to ticket
4. Move ticket to Review column

### PR Revision Flow

When a PR receives feedback requesting changes (`prlt work revise`):
1. Fetch PR feedback (reviews, comments, review decision)
2. Check for pending changes requested
3. Move ticket back to In Progress column
4. Spawn agent with PR feedback in prompt
5. Agent addresses feedback, commits, and pushes
6. PR is updated automatically

## Related Domains

- [Work](work.md) - Work commands that integrate with PR workflow
- [Tickets](tickets.md) - Tickets store PR metadata
- [Settings](settings.md) - Future: PR-related settings

## CLI Examples

```bash
# Create PR from current branch (auto-detect ticket)
prlt pr create

# Create PR and link to specific ticket
prlt pr create TKT-001

# Create draft PR
prlt pr create --draft

# Link existing PR to ticket
prlt pr link TKT-001 --pr 42

# Link PR by URL
prlt pr link TKT-001 --url https://github.com/owner/repo/pull/42

# View PR status for ticket
prlt pr status TKT-001

# Interactive PR menu
prlt pr

# Address PR feedback (revision)
prlt work revise TKT-001

# Force revision even without pending feedback
prlt work revise TKT-001 --force
```
