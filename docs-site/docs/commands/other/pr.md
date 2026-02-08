---
sidebar_position: 4
title: pr
---

# prlt pr

Manage pull requests for tickets.

## Usage

```bash
prlt pr <subcommand>
```

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated, or `GITHUB_TOKEN` set
- Run `prlt gh status` to verify authentication

## Subcommands

### pr create

Create a pull request for a ticket. Uses the ticket's branch and creates a PR with ticket details.

```bash
prlt pr create <ticket-id>
prlt pr create TKT-001
```

**Output:**
```text
✓ Created PR #123 for TKT-001
  URL: https://github.com/org/repo/pull/123
```

### pr list

List all PRs linked to tickets in the workspace.

```bash
prlt pr list
```

**Output:**
```text
┌──────────┬────────────────────┬──────────┬──────────────────────────────────────┐
│ Ticket   │ Title              │ Status   │ PR URL                               │
├──────────┼────────────────────┼──────────┼──────────────────────────────────────┤
│ TKT-001  │ Add OAuth          │ Open     │ https://github.com/org/repo/pull/123 │
│ TKT-002  │ Fix login bug      │ Merged   │ https://github.com/org/repo/pull/124 │
└──────────┴────────────────────┴──────────┴──────────────────────────────────────┘
```

### pr status

Check the status of a PR linked to a ticket. Shows review status, checks, and mergeability.

```bash
prlt pr status <ticket-id>
prlt pr status TKT-001
```

**Output:**
```text
PR #123: Add OAuth login
Status: Open
Reviews: 1 approved, 1 pending
Checks: ✓ All passing
Mergeable: Yes
URL: https://github.com/org/repo/pull/123
```

### pr link

Link an existing GitHub PR to a ticket.

```bash
prlt pr link <ticket-id> <pr-url>
prlt pr link TKT-001 https://github.com/org/repo/pull/123
```

**Output:**
```text
✓ Linked PR #123 to TKT-001
```

## See Also

- [GitHub Integration Guide](/guides/github-integration)
- [work ready](/commands/work/ready) - Mark work ready and create PR
- [gh](/commands/other/gh) - GitHub CLI setup
