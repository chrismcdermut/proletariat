---
sidebar_position: 6
title: Actions
---

# Actions

Actions are reusable prompt templates that define what agents do.

## Built-in Actions

prlt includes these standard actions:

| Action | Purpose |
|--------|---------|
| `implement` | Write code to fulfill ticket requirements |
| `groom` | Refine ticket with AC, subtasks, estimates |
| `review` | Review code and suggest improvements |

## Using Actions

### With work start

```bash
prlt work start TKT-001 --action implement
prlt work start TKT-001 --action groom
prlt work start TKT-001 --action review
```

### Interactive Selection

```bash
prlt work spawn
# Select action from menu
```

## Creating Custom Actions

### Interactive Creation

```bash
prlt action create
```

You'll be prompted for:
- Name
- Description
- Prompt template

### Flag-based Creation

```bash
prlt action create \
  --name "security-audit" \
  --description "Audit code for security vulnerabilities" \
  --prompt "Review the code for security issues including SQL injection, XSS, and authentication problems. Create a report with findings and fixes."
```

## Action Templates

### Prompt Variables

Use variables in your prompts:

| Variable | Description |
|----------|-------------|
| `{{ticket.title}}` | Ticket title |
| `{{ticket.description}}` | Ticket description |
| `{{ticket.acceptance_criteria}}` | Acceptance criteria |
| `{{ticket.id}}` | Ticket ID |

### Example: Documentation Action

```bash
prlt action create \
  --name "document" \
  --description "Generate documentation for code" \
  --prompt "Generate comprehensive documentation for the code related to {{ticket.title}}. Include:
- Function/method descriptions
- Parameter documentation
- Return value documentation
- Usage examples
- Edge cases"
```

### Example: Test Action

```bash
prlt action create \
  --name "write-tests" \
  --description "Write unit tests for ticket work" \
  --prompt "Write comprehensive unit tests for {{ticket.title}}. Ensure:
- All acceptance criteria are tested
- Edge cases are covered
- Tests are well-documented
- Follow existing test patterns"
```

### Example: Refactor Action

```bash
prlt action create \
  --name "refactor" \
  --description "Refactor code for better maintainability" \
  --prompt "Refactor the code related to {{ticket.title}}. Focus on:
- Code clarity and readability
- Reducing duplication
- Improving naming
- Adding appropriate comments
- Maintaining existing functionality"
```

## Managing Actions

### List Actions

```bash
prlt action list
```

### View Action Details

```bash
prlt action show security-audit
```

### Update Action

```bash
prlt action update security-audit \
  --prompt "Updated prompt text..."
```

### Delete Action

```bash
prlt action delete security-audit
```

## Running Actions Directly

Execute an action without a ticket:

```bash
prlt action run security-audit
```

With context:

```bash
prlt action run document --context "src/auth/"
```

## Action Chaining

Run multiple actions in sequence:

```bash
# Groom, then implement
prlt work start TKT-001 --action groom
# Wait for completion
prlt work start TKT-001 --action implement
```

Or automate:

```bash
prlt work start TKT-001 --actions groom,implement
```

## Best Practices

### Clear Prompts

Write prompts that are:
- Specific about expected output
- Clear about scope
- Explicit about quality expectations

```bash
# Good
"Review authentication code for security vulnerabilities. Check for:
1. SQL injection
2. XSS attacks
3. CSRF vulnerabilities
Create issues for each finding."

# Bad
"Check the code for problems"
```

### Reusable Templates

Create actions for common patterns:

```bash
# Frontend component
prlt action create --name "react-component" \
  --prompt "Create a React component for {{ticket.title}}..."

# API endpoint
prlt action create --name "api-endpoint" \
  --prompt "Implement an API endpoint for {{ticket.title}}..."

# Database migration
prlt action create --name "db-migration" \
  --prompt "Create a database migration for {{ticket.title}}..."
```

### Team Sharing

Actions are stored in the workspace database and available to all agents.

## Workflow Integration

### Ticket to PR Pipeline

```bash
# 1. Groom the ticket
prlt work start TKT-001 --action groom

# 2. Implement the feature
prlt work start TKT-001 --action implement

# 3. Write tests
prlt work start TKT-001 --action write-tests

# 4. Document
prlt work start TKT-001 --action document

# 5. Security review
prlt work start TKT-001 --action security-audit
```

### Quality Gate

```bash
# Before marking ready, run review
prlt work start TKT-001 --action review

# If passes, mark ready
prlt work ready TKT-001 --pr
```

## Next Steps

- [Command Reference: action](/commands/other/action) - Full action command docs
- [Spawning Agents](/guides/spawning-agents) - Run actions on tickets
- [Multi-Agent Workflows](/guides/multi-agent-workflows) - Scale with actions
