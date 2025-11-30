---
title: PMO Work Commands Specification
created: 2024-11-28
tickets:
  - id: WORK-001
    title: Implement prlt ticket assign command
    description: Create interactive command to assign tickets to humans or agents with dropdown selection
    priority: HIGH
    category: feature
  - id: WORK-002
    title: Implement prlt ticket own command
    description: Create command for humans to take ownership/responsibility of tickets
    priority: MEDIUM
    category: feature
  - id: WORK-003
    title: Implement prlt ticket claim command
    description: Create command for humans to claim tickets (own + execute)
    priority: MEDIUM
    category: feature
  - id: WORK-004
    title: Add owner and assignee columns to pmo_tickets table
    description: Migrate from pmo_ticket_assignments table to simple owner/assignee columns
    priority: HIGH
    category: backend
  - id: WORK-005
    title: Implement backend assignTicket method
    description: Add storage method to set ticket assignee with optional owner
    priority: HIGH
    category: backend
  - id: WORK-006
    title: Implement backend ownTicket method
    description: Add storage method to set ticket owner
    priority: MEDIUM
    category: backend
  - id: WORK-007
    title: Implement backend claimTicket method
    description: Add storage method to set both owner and assignee
    priority: MEDIUM
    category: backend
  - id: WORK-008
    title: Add getAssignedTickets to Agent SDK
    description: Implement agent polling for tickets assigned to them
    priority: MEDIUM
    category: agent-sdk
  - id: WORK-009
    title: Implement prlt ticket execute command
    description: Execute a ticket by spinning up the assigned agent or prompting human to start work
    priority: HIGH
    category: feature
---

# PMO Work Commands Specification

## Purpose
Commands for managing work assignment, ownership, and orchestration within the PMO system. These commands operate on tickets but focus on **who does the work** rather than ticket data management.

## Core Concepts
- **Owner**: Human responsible/accountable for ticket completion
- **Assignee**: Executor (human or agent) who performs the work
- **Orchestration**: Human-driven delegation to humans or agents
- **Claiming**: Solo work where human owns and executes
- **Agent Workflow**: Agents never claim autonomously - always assigned by orchestrators

## Namespace
All work commands are under the `prlt ticket` namespace but handle workflow/orchestration:
- `prlt ticket assign` - Delegate execution (metadata only)
- `prlt ticket own` - Take responsibility
- `prlt ticket claim` - Own + execute yourself
- `prlt ticket execute` - Actually start work on ticket

## Command Overview

| Command                           | Purpose                                | Status            |
| --------------------------------- | -------------------------------------- | ----------------- |
| `prlt ticket assign [id] [agent]` | Assign executor (metadata only)        | ❌ Not Implemented |
| `prlt ticket own [id]`            | Take ownership (responsibility)        | ❌ Not Implemented |
| `prlt ticket claim [id]`          | Claim ticket (own + execute)           | ❌ Not Implemented |
| `prlt ticket execute [id]`        | Execute ticket (spin up agent/start)   | ❌ Not Implemented |

---

## Command Specifications

### `prlt ticket assign [id] [agent]`
**Purpose**: Assign executor to ticket (human or agent)

**Ownership Model**:
- `owner`: Human responsible/accountable for the ticket
- `assignee`: Executor who will do the work (human OR agent)
- This command sets the `assignee` field
- Agents are always **assigned** by orchestrators (never claim autonomously)

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided
- `agent` (optional): Agent/user to assign - prompts with dropdown if not provided

**Options**:
- `--owner <name>`: Also set the owner (default: unchanged)

**Interactive Flow** (if arguments not provided):
```
? Select ticket to assign:
  ❯ TICK-001 - Add login screen (Backlog, unassigned)
    TICK-002 - Setup CI/CD (Backlog, unassigned)
    TICK-003 - Implement navigation (In Progress, @alice)

? Assign TICK-001 to:
    Unassign (remove assignee)
    ── Common Agents ──
  ❯ alice
    bob
    charlie
    ────────────────────
    Enter custom name...

✅ Assigned TICK-001 to alice
   Title: Add login screen
```

**Example**:
```bash
prlt ticket assign TICK-001 alice
prlt ticket assign TICK-001 claude      # Assign to AI agent
prlt ticket assign TICK-001 --owner chris  # Set owner too
prlt ticket assign  # Interactive mode
```

**Behavior**:
- If no arguments provided, shows interactive dropdowns
- Dropdown includes unassign option, common agents, and custom name entry
- Sets `assignee` field (executor)
- Optionally sets `owner` field with --owner flag
- Used by human orchestrators to delegate work to humans or agents

**Backend Implementation**:
```typescript
interface AssignTicketParams {
  ticketId: string;
  assignee: string | null;  // null to unassign
  owner?: string;           // optional: also set owner
}

await storage.assignTicket(params);
```

---

### `prlt ticket own [id]`
**Purpose**: Take ownership/responsibility for ticket (without necessarily executing)

**Ownership Model**:
- Sets `owner` field to current user (human takes responsibility)
- Leaves `assignee` unchanged (execution may be delegated)
- Use when you're accountable but delegating execution to others

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to own:
  ❯ TICK-001 - Add login screen (Backlog, unassigned)
    TICK-002 - Setup CI/CD (Backlog, @claude)
    TICK-003 - Implement navigation (In Progress, @alice)

✅ You now own TICK-001
   Owner: chris
   Assignee: unassigned (can delegate with 'prlt ticket assign')
```

**Example**:
```bash
prlt ticket own TICK-001
prlt ticket own  # Interactive mode
```

**Behavior**:
- Sets `owner` = current user (accountable)
- Leaves `assignee` unchanged
- Use case: Product owner takes responsibility, will assign to dev/agent later
- Complements `prlt ticket assign` for delegation workflow

**Backend Implementation**:
```typescript
interface OwnTicketParams {
  ticketId: string;
  owner: string;  // current user
}

await storage.ownTicket(params);
```

---

### `prlt ticket claim [id]`
**Purpose**: Human claims ticket (takes ownership AND execution)

**Ownership Model**:
- CLI context: Human claims = sets BOTH `owner` and `assignee` to current user
- Agents never claim autonomously - they are always assigned by orchestrators
- Use `prlt ticket assign` to delegate to agents or other humans

**Arguments**:
- `id` (optional): Ticket ID (prompts to select if not provided)

**Interactive Flow** (no ID provided):
```
? Select ticket to claim:
  ❯ TICK-001 - Add login screen (high, unassigned)
    TICK-002 - Setup CI/CD (medium, @bob)

✅ Claimed TICK-001
   Owner: chris
   Assignee: chris
   Moved to: In Progress
```

**Example**:
```bash
prlt ticket claim TICK-001
prlt ticket claim  # Interactive mode
```

**Behavior**:
- Auto-detects current user from system
- Sets `owner` = current user (takes responsibility)
- Sets `assignee` = current user (will execute)
- Optionally moves to "In Progress"
- **Human-only command** - agents use assigned work queue instead

**Backend Implementation**:
```typescript
interface ClaimTicketParams {
  ticketId: string;
  user: string;       // current user (becomes both owner and assignee)
  moveToInProgress?: boolean;  // default: true
}

await storage.claimTicket(params);
```

---

### `prlt ticket execute [id]`
**Purpose**: Execute a ticket by spinning up the assigned agent or prompting human to start work

**Ownership Model**:
- Reads `assignee` field to determine who should execute
- If `assignee=agent:xxx`, spins up that agent
- If `assignee=human`, prompts/notifies them
- If `assignee` is unset, errors or prompts to assign first

**Arguments**:
- `id` (optional): Ticket ID (prompts to select if not provided)

**Flags**:
- `--force`: Execute even if already in progress
- `--watch`: Stream agent output in real-time

**Output**:
```
🚀 Executing TICK-001: Implement authentication
   Assignee: agent:codegen

   Spinning up agent:codegen...
   ✓ Agent started

   → Agent is working on ticket...
   → View progress: prlt ticket view TICK-001
```

**Example**:
```bash
prlt ticket execute TICK-001           # Execute assigned work
prlt ticket execute TICK-001 --watch   # Stream agent output
prlt ticket execute                    # Interactive mode
```

**Behavior**:
- Checks `assignee` field
- If `assignee` starts with `agent:`, spins up that agent with ticket context
- If `assignee` is human, prints message or sends notification
- Moves ticket to "In Progress" column
- Creates execution record/log

**Backend Implementation**:
```typescript
interface ExecuteTicketParams {
  ticketId: string;
  force?: boolean;
  watch?: boolean;
}

// Returns execution status or agent handle
await storage.executeTicket(params);
```

**Agent Integration**:
- Passes ticket ID, title, description, spec to agent
- Agent can update ticket status during work
- Agent moves ticket to "Done" when complete

---

## Workflow Patterns

### Pattern 1: Solo Work (Developer)
**Use Case**: Individual developer working alone on a ticket

```bash
# Claim ticket (own + execute)
prlt ticket claim TICK-001

# Work on ticket...

# Complete when done
prlt ticket complete TICK-001
```

**Result**: `owner=chris`, `assignee=chris`

---

### Pattern 2: Orchestrator → Agent (Assign + Execute)
**Use Case**: PM delegates to AI agent and triggers execution

```bash
# PM takes ownership
prlt ticket own TICK-002

# PM assigns to agent (metadata only)
prlt ticket assign TICK-002 @codegen

# PM triggers execution (spins up agent)
prlt ticket execute TICK-002

# Agent works on ticket...
# Agent reports completion when done
```

**Result**: `owner=pm`, `assignee=agent:codegen`, ticket moves to "In Progress"

---

### Pattern 3: Orchestrator → Human Developer
**Use Case**: Tech lead delegates to team member

```bash
# Tech lead takes ownership
prlt ticket own TICK-003

# Assign to developer
prlt ticket assign TICK-003 alice

# Alice can see it in her assigned work
prlt ticket list --assignee alice
```

**Result**: `owner=techlead`, `assignee=alice`

---

### Pattern 4: Reassignment
**Use Case**: Work needs to be moved between executors

```bash
# Unassign from current executor
prlt ticket assign TICK-004 ""

# Reassign to different executor
prlt ticket assign TICK-004 bob
```

**Result**: `owner=unchanged`, `assignee=bob`

---

## Design Principles

### Orchestration Model
- **Human-Driven**: Humans orchestrate, agents execute when assigned
- **Explicit Assignment**: Agents never claim work autonomously
- **Clear Accountability**: Owner is always a human (product/tech lead)
- **Flexible Execution**: Assignee can be human or agent

### Separation of Concerns
- **Ownership**: Who is responsible? (Product owner, tech lead)
- **Assignment**: Who will execute? (Developer, AI agent)
- **Claiming**: Solo work pattern (same person owns and executes)

### Interactive Defaults
- **No arguments**: Always prompt with dropdown
- **Common agents**: Pre-populate dropdown with theme agents
- **Custom names**: Allow arbitrary agent/user names
- **Unassign option**: Easy way to remove assignment

---

## Database Schema Requirements

### Table: `pmo_tickets`
**Required columns**:
```sql
ALTER TABLE pmo_tickets ADD COLUMN owner TEXT;
ALTER TABLE pmo_tickets ADD COLUMN assignee TEXT;
```

**Note**: Replace the existing `pmo_ticket_assignments` many-to-many table with these simple columns.

---

## Agent SDK Integration

### Polling for Assigned Work
**Agent SDK method**:
```typescript
// Agent polls for work assigned to it
const tickets = await sdk.getAssignedTickets();

for (const ticket of tickets) {
  // Execute work...

  // Report completion
  await sdk.completeTicket(ticket.id);
}
```

### Backend Support
```typescript
// PMOStorage method
async getAssignedTickets(assignee: string): Promise<Ticket[]> {
  return await this.db.query(
    'SELECT * FROM pmo_tickets WHERE assignee = ? AND status != "done"',
    [assignee]
  );
}
```

---

## Testing Strategy

### Unit Tests
- Test ownership setting without changing assignee
- Test assignment setting without changing owner
- Test claim setting both owner and assignee
- Test unassignment (set assignee to null)
- Test --owner flag on assign command

### Integration Tests
- Test full workflow: own → assign → complete
- Test agent polling for assigned tickets
- Test reassignment between executors
- Test human claim → agent reassign

### UI/UX Tests
- Test interactive dropdowns with theme agents
- Test custom name entry
- Test unassign option
- Test cancellation flows

---

## Future Enhancements

### Work Queue Commands
```bash
prlt work mine              # Show my assigned tickets
prlt work agent [name]      # Show agent's assigned tickets
prlt work unassigned        # Show unassigned tickets
```

### Bulk Assignment
```bash
prlt ticket assign --column Backlog --assignee claude
prlt ticket assign TICK-001,TICK-002,TICK-003 alice
```

### Assignment Notifications
```bash
# Agent SDK hook
sdk.onAssigned((ticket) => {
  console.log(`New work assigned: ${ticket.id}`);
});
```

---

## Migration Path

1. **Add columns** to `pmo_tickets` table
2. **Migrate data** from `pmo_ticket_assignments` table (if exists)
3. **Implement backend methods**: assignTicket(), ownTicket(), claimTicket()
4. **Create command files**: ticket/assign.ts (complete), ticket/own.ts, ticket/claim.ts
5. **Test workflows** with humans and agents
6. **Update Agent SDK** to poll for assigned work
7. **Drop** `pmo_ticket_assignments` table (if not needed)
