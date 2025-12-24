---
title: Pull Requests
domain: pull-requests
---

# Pull Requests

## Overview

Pull Requests (PRs) connect work tickets to code changes in Git repositories. PRs are created via the GitHub CLI (`gh`) and linked to tickets for traceability. The system supports auto-detection of ticket IDs from branch names and generates PR titles/bodies from ticket information.

## Abilities

### Create PR

Create a GitHub pull request from the current branch.

| Modality | Signature |
|----------|-----------|
| cli | `prlt pr create [ticketId]` |
| lib | `createPR(options)` |

**Flags:**
- `--base`, `-b`: Base branch for the PR (defaults to main/master)
- `--draft`, `-d`: Create as draft PR
- `--no-link`: Skip linking PR to ticket
- `--title`, `-t`: PR title (auto-generated from ticket if not provided)
- `--body`: PR body/description

### Link PR

Link an existing GitHub pull request to a ticket.

| Modality | Signature |
|----------|-----------|
| cli | `prlt pr link [ticketId]` |
| storage | `updateTicket(id, { metadata: { pr_url, pr_number } })` |

**Flags:**
- `--pr`, `-p`: PR number to link
- `--url`, `-u`: PR URL to link

### View PR status

View PR status for a ticket.

| Modality | Signature |
|----------|-----------|
| cli | `prlt pr status [ticketId]` |
| lib | `getPRByNumber(number)` |

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

1. `work start` - Creates branch for ticket
2. (Agent works on ticket)
3. `work ready` - Can trigger PR creation (see integration)
4. Human reviews PR
5. `work complete` - Ticket moves to Done

### Future: Auto-create PR on work ready

When an agent calls `prlt work ready`, the system can automatically:
1. Push all commits to origin
2. Create a draft PR
3. Link PR to ticket
4. Move ticket to Review column

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
```
