# Ticket Lifecycle Workflow

This guide walks through the complete lifecycle of a ticket from creation to merge.

## Overview

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Create    │───▶│   Groom     │───▶│   Spawn     │───▶│   Review    │───▶│   Merge     │
│   Ticket    │    │   Ticket    │    │   Work      │    │   PR        │    │   & Close   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
     │                  │                  │                  │                  │
     ▼                  ▼                  ▼                  ▼                  ▼
  Backlog           Planned          In Progress         In Review            Done
```

## Step 1: Create Ticket

### Interactive Creation

```bash
prlt ticket create
```

Answer the prompts for:
- Title
- Description
- Priority
- Category

### Command-Line Creation

```bash
prlt ticket create \
  --title "Add password reset functionality" \
  --description "Users need ability to reset forgotten passwords via email" \
  --priority P1 \
  --category feature
```

### Verify Creation

```bash
prlt ticket list
# Shows: TKT-042 in Backlog
```

## Step 2: Groom Ticket

Grooming adds the details agents need to implement successfully.

### Manual Grooming

```bash
prlt ticket edit TKT-042 \
  --description "Add password reset flow with email verification.

Requirements:
- R1: User clicks 'Forgot Password' on login page
- R2: System sends reset link via email
- R3: Link expires after 24 hours
- R4: User sets new password via secure form" \
  --add-subtask "Create password reset request endpoint" \
  --add-subtask "Implement email sending service" \
  --add-subtask "Create reset token validation" \
  --add-subtask "Build password reset form" \
  --add-subtask "Add rate limiting" \
  --add-ac "Users receive reset email within 1 minute" \
  --add-ac "Reset links expire after 24 hours" \
  --add-ac "Users can set new password with valid token" \
  --add-ac "Invalid/expired tokens show error message" \
  --add-label "complexity:M" \
  --add-label "ready"
```

### AI-Assisted Grooming

Have an agent groom the ticket:

```bash
prlt work start TKT-042 --action groom
```

The agent will:
- Analyze requirements
- Add detailed acceptance criteria
- Break into subtasks
- Estimate complexity

### Move to Planned

Once groomed, move to planned:

```bash
prlt ticket move TKT-042 Planned
```

## Step 3: Spawn Work

### Start Work with Agent

```bash
prlt work start TKT-042
```

Select:
- **Agent**: Choose from available agents
- **Mode**: Docker (recommended)
- **Action**: Implement

Or specify all options:

```bash
prlt work start TKT-042 \
  --agent alice \
  --mode docker \
  --action implement \
  --create-pr
```

### What Happens

1. Ticket moves to "In Progress"
2. Agent is assigned
3. Git branch created: `feat/alice/TKT-042-password-reset`
4. Container starts (Docker mode)
5. Agent reads ticket and begins coding

### Monitor Progress

```bash
# Watch board
prlt board watch

# View logs
prlt execution logs --follow
```

## Step 4: Review PR

### Check PR Status

```bash
prlt pr status TKT-042
```

### Review in GitHub

```bash
# View PR
gh pr view

# Check diff
gh pr diff

# Add review comments
gh pr review --comment -b "Looks good, minor suggestions..."

# Approve
gh pr review --approve
```

### Request Changes

If changes needed:

```bash
gh pr review --request-changes -b "Please add input validation"
```

Agent can address feedback:

```bash
prlt work start TKT-042 --action implement --force
# Agent reads PR comments and makes changes
```

## Step 5: Merge & Close

### Merge PR

```bash
gh pr merge --squash
```

Or merge in GitHub UI.

### Ticket Auto-Updates

When PR merges:
- Ticket moves to "Done"
- Work execution marked complete

### Manual Close (if needed)

```bash
prlt ticket move TKT-042 Done
```

## Complete Example

```bash
# 1. Create ticket
prlt ticket create \
  --title "Add password reset functionality" \
  --description "Users need ability to reset forgotten passwords" \
  --priority P1 \
  --category feature

# 2. Groom ticket
prlt ticket edit TKT-042 \
  --add-subtask "Create reset endpoint" \
  --add-subtask "Send reset email" \
  --add-subtask "Build reset form" \
  --add-ac "Reset email sent within 1 minute" \
  --add-ac "Reset link expires after 24 hours" \
  --add-label "complexity:M" \
  --add-label "ready"

# 3. Move to planned
prlt ticket move TKT-042 Planned

# 4. Start work
prlt work start TKT-042 --mode docker --create-pr

# 5. Monitor
prlt board watch

# 6. Review PR
gh pr view
gh pr review --approve

# 7. Merge
gh pr merge --squash

# Ticket automatically moves to Done
prlt ticket list --status Done
```

## Workflow Variations

### Bug Fix Flow

```bash
# Create with bug category
prlt ticket create \
  --title "Fix login timeout error" \
  --category bug \
  --priority P0

# Start immediately (skip grooming for urgent bugs)
prlt work start TKT-043 --action implement
```

### Documentation Flow

```bash
prlt ticket create \
  --title "Document API endpoints" \
  --category docs

# Use docs action
prlt work start TKT-044 --action implement
```

### Refactor Flow

```bash
prlt ticket create \
  --title "Refactor auth module" \
  --category refactor

# May need more context
prlt work start TKT-045 \
  --prompt "Refactor for better testability, maintain existing API"
```

## Handling Edge Cases

### Ticket Needs More Info

```bash
# Add needs-clarification label
prlt ticket edit TKT-042 --add-label "needs-clarification"

# Add comment in description
prlt ticket edit TKT-042 \
  --description "...\n\n**Questions:**\n- What email provider to use?"
```

### Ticket Blocked

```bash
# Move to blocked status (if configured)
prlt ticket move TKT-042 Blocked

# Or add label
prlt ticket edit TKT-042 --add-label "blocked"
```

### Cancel Ticket

```bash
prlt ticket move TKT-042 Canceled
```

### Split Large Ticket

```bash
# Create sub-tickets
prlt ticket create --title "Password reset: Backend API"
prlt ticket create --title "Password reset: Email service"
prlt ticket create --title "Password reset: Frontend form"

# Link to epic
prlt epic create --title "Password Reset Feature"
prlt epic ticket EPIC-001 TKT-042 TKT-043 TKT-044
```

## Status Reference

| Status | Meaning | Trigger |
|--------|---------|---------|
| Backlog | Unplanned work | Created |
| Planned | Ready for development | Manual move |
| In Progress | Agent working | `work start` |
| In Review | PR open | Agent creates PR |
| Done | Completed | PR merged |
| Canceled | Abandoned | Manual move |

## Best Practices

### Write Clear Acceptance Criteria

```bash
# Good - specific and testable
--add-ac "Users receive reset email within 1 minute"

# Bad - vague
--add-ac "Email works"
```

### Break Down Large Tickets

If a ticket has more than 5-7 subtasks, consider splitting into multiple tickets.

### Use Consistent Categories

- `feature` - New functionality
- `bug` - Fixing broken behavior
- `refactor` - Improving code quality
- `docs` - Documentation
- `test` - Test coverage
- `chore` - Maintenance tasks

### Review Promptly

Don't let PRs sit - review within 24 hours when possible.

## Related Guides

- [Creating Good Tickets](../concepts/pmo.md#tickets) - Ticket best practices
- [Multi-Agent Workflows](./multi-agent.md) - Parallel development
- [Troubleshooting](../troubleshooting.md) - Common issues
