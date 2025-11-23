# End of Day Log - PMO Refactoring
Date: 2024-11-22

## What We Accomplished Today

### 1. Major Refactoring - Manager Pattern
- ✅ Renamed `TicketManager` → `PMOManager` (better naming)
- ✅ Consolidated all PMO functionality into one manager class
- ✅ Removed duplicate directories (`/lib/agents/`, `/lib/repos/`, `/lib/pmo/`)
- ✅ Moved `initPMOForHQ` into `PMOManager.initForHQ()` static method

### 2. Command Consolidation
- ✅ Removed duplicate ticket commands (`add-ticket`, `claim`)
- ✅ Consolidated to single `prlt ticket [action]` command
- ✅ Made `prlt ticket` interactive when no action provided

### 3. New Assignment Features
- ✅ Added `assign` method
- ✅ Added `reassign` method  
- ✅ Added `unassign` method

### 4. Template Organization
- ✅ Reorganized templates into subdirectories:
  - `templates/boards/` (kanban templates)
  - `templates/tickets/` (ticket templates)
  - Examples as subdirectories

### 5. Test Organization
- ✅ Moved test configs to `/test/config/`
- ✅ Updated all test references

## Issues to Fix Tomorrow

### 1. Command Signatures Need Two Arguments
**Current Problem:** Commands only accept one ID parameter
```bash
prlt ticket assign [ticketId]       # Wrong - which agent?
prlt ticket reassign [ticketId]     # Wrong - which agent?
```

**Should Be:**
```bash
prlt ticket assign [ticketId] [agentName]    # Assign ticket to specific agent
prlt ticket reassign [ticketId] [agentName]  # Reassign to different agent
```

**Interactive Fallback:**
- If no args → show ticket list, then agent list
- If only ticketId → show agent list
- If only agentName → show ticket list for that action
- If both → direct assignment

### 2. Update Command Parser
Need to update `prlt.ts` to accept two parameters:
```typescript
.command('ticket [action] [id] [agent]')  // Two optional params
```

And update the switch cases to handle both parameters properly.

### 3. PMO Git Repository Strategy

**Questions to Address:**
- Should PMO be its own git repo? (Currently yes)
- Branching strategy for tickets?
  - One branch per ticket? (e.g., `ticket/T0001`)
  - One branch per agent? (e.g., `agent/elon`)
  - Or just track in main?
- How to sync PMO changes across agents?
- Should ticket completion trigger a commit?

### 4. Missing PMO Features

**Potential additions:**
- `prlt ticket status [id] [new-status]` - Change ticket status manually
- `prlt ticket priority [id] [priority]` - Update priority
- `prlt ticket move [id] [queue]` - Move between queues
- `prlt ticket archive [id]` - Archive completed tickets
- `prlt ticket search [term]` - Search tickets
- `prlt ticket filter [criteria]` - Filter by status/agent/queue

### 5. Integration Points

**Agent-Ticket Integration:**
- Should `prlt agent remove` check for assigned tickets?
- Should switching agents (`prlt agent switch`) show their tickets?
- Should agents have a "my tickets" view?

**Repo-Ticket Integration:**
- Link tickets to specific repos?
- Auto-create branches in repos for tickets?
- Track which repos a ticket affects?

### 6. Claude Integration
- The `claim` command launches Claude with context
- Should `assign` also have an option to launch Claude?
- Should there be a `prlt ticket work [id]` command that sets up the full work environment?

## Next Priority Order

1. **Fix command signatures** - Critical for usability
2. **Decide on PMO git strategy** - Affects how we track changes
3. **Add status/priority/move commands** - Basic ticket management
4. **Enhance agent-ticket integration** - Better workflow
5. **Add search/filter** - Needed as tickets grow

## Code Locations for Tomorrow

Key files to modify:
- `/src/bin/prlt.ts` - Update command signatures (lines 274-334)
- `/src/lib/managers/PMOManager.ts` - Update assign/reassign methods to accept agent parameter
- `/src/lib/managers/types.ts` - Update IPMOManager interface

## Test Commands for Tomorrow

```bash
# Test two-parameter commands
prlt ticket assign T0001 elon
prlt ticket reassign T0001 jeff

# Test interactive fallbacks  
prlt ticket assign T0001        # Should prompt for agent
prlt ticket assign elon          # Should show Elon's assignable tickets
prlt ticket assign               # Should prompt for both

# Test PMO git operations
cd HQ/pmo && git log            # Check commit history
cd HQ/pmo && git branch          # Check branching
```

## Questions for User

1. Do you want tickets to create git branches automatically?
2. Should ticket assignment be recorded in git history?
3. Do you want per-agent ticket views or global only?
4. Should we add ticket dependencies (blocked by, blocks)?
5. Integration with external tools (GitHub Issues, Jira)?

---

Good night! This log should help us pick up exactly where we left off. The main priority is fixing those command signatures to properly accept both ticket ID and agent name.