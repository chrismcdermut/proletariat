# PMO (Project Management Office)

## Storage: SQLite
## Template: founder

## Structure
- **projects/{id}/board.md** - Kanban boards (Obsidian compatible, auto-synced with database)
- **projects/{id}/specs/** - Detailed specifications for tickets (active, complete, future, dropped)
- Data stored in `../.proletariat/workspace.db` (pmo_* tables)

## Ticket ID Convention

Tickets use the format: `{spec-name}-{sequence}`

Examples:
- `pmo-ticket-commands-001` - From pmo-ticket-commands.md spec
- `pmo-board-commands-001` - From pmo-board-commands.md spec
- `pmo-schema-refactor-001` - From pmo-schema-refactor.md spec

Benefits:
- ✅ Guaranteed uniqueness (spec name + sequence)
- ✅ Clear origin (you know which spec it came from)
- ✅ Automatic categorization (grouped by spec)
- ✅ No manual collision checking

## Ticket Format

Tickets in board.md use this format:
```markdown
- [ ] **pmo-ticket-commands-001** [[pmo-ticket-commands-001]] Implement prlt ticket list command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Create command to list all tickets with filtering
```

Components:
- `**pmo-ticket-commands-001**` - Bold ID for visual scanning
- `[[pmo-ticket-commands-001]]` - Wikilink to ticket note (click to open/create in Obsidian)
- Title and metadata below

---

## Commands

### PMO Initialization
```bash
prlt pmo init                    # Initialize PMO system
```

### Board Commands
```bash
prlt board                       # Interactive menu for board operations
prlt board view                  # View kanban board in terminal
prlt board open                  # Open board in Obsidian
prlt board markdown              # Show board as markdown
prlt board export                # Export board to file
prlt board sync                  # Sync between SQLite and board.md
prlt board watch                 # Watch board.md for changes

# Options
prlt board view --project <id>            # View specific project
prlt board view --assignee <assignee>     # Filter by assignee (planned)
prlt board view --priority <priority>     # Filter by priority (planned)
```

### Ticket Commands
```bash
prlt ticket                      # Interactive menu for ticket operations
prlt ticket create [title]       # Create new ticket
prlt ticket list                 # List all tickets (not implemented)
prlt ticket view [id]            # View ticket details (not implemented)
prlt ticket move [id] [column]   # Move ticket to column
prlt ticket delete [id]          # Delete ticket

# Options
prlt ticket create --title "My ticket" --column "Backlog"
prlt ticket create --priority HIGH --assignee alice
prlt ticket list --column "In Progress"
prlt ticket list --priority URGENT
prlt ticket move TICKET-001 "In Progress"
prlt ticket delete TICKET-001 --force
```

### Bulk Ticket Operations
```bash
prlt ticket bulk move            # Move multiple tickets to column
prlt ticket bulk delete          # Delete multiple tickets
prlt ticket bulk reassign        # Reassign tickets to different spec
prlt ticket bulk update          # Update priority/category for multiple

# Options
prlt ticket bulk move --from "Backlog" --priority HIGH
prlt ticket bulk delete --column "Dropped" --force
prlt ticket bulk update --priority HIGH
```

### Spec Commands
```bash
prlt spec                        # Interactive menu for spec operations
prlt spec list                   # List all specs
prlt spec create                 # Create new spec
prlt spec view <spec-id>         # View spec details
prlt spec generate-tickets <spec-id>  # Generate tickets from spec YAML

# Options
prlt spec create --title "My Spec" --status active
prlt spec generate-tickets pmo-ticket-commands
prlt spec generate-tickets --dry-run
```

### Project Commands
```bash
prlt project                     # Interactive menu for project operations
prlt project list                # List all projects
prlt project create              # Create new project
prlt project view [id]           # View project details
prlt project switch [id]         # Switch current project

# Options
prlt project create --name "Mobile App" --id mobile-app
```

### Work Assignment Commands
```bash
prlt ticket assign [id]          # Assign ticket to human/agent
prlt ticket own [id]             # Take ownership of ticket
prlt ticket claim [id]           # Claim ticket (own + execute)
prlt ticket execute [id]         # Execute assigned ticket

# Options
prlt ticket assign TICKET-001 --to alice
prlt ticket assign TICKET-001 --to agent:developer
```

---

## Interactive Menus

### Main Ticket Menu
```
🎫 Ticket Operations

? What would you like to do?
  ❯ Create new ticket
    List all tickets
    View ticket details
    Move ticket
    Delete ticket
    ────────────
    Bulk operations →
    ────────────
    Cancel
```

### Bulk Operations Submenu
```
📋 Bulk Ticket Operations

? Select bulk operation:
  ❯ Move tickets (change column)
    Delete tickets
    Reassign tickets (change spec)
    Update tickets (priority/category/assignee)
    ────────────
    ← Back
    Cancel
```

---

## Obsidian Setup

1. Open this folder as an Obsidian vault
2. Install the "Kanban" plugin
3. Open `projects/{project-id}/board.md` and switch to Kanban view
4. Click ticket wikilinks to create/open dedicated ticket notes

## Database Schema

### Core Tables
- `pmo_projects` - Projects
- `pmo_columns` - Board columns per project
- `pmo_tickets` - Ticket data (title, description, priority, status, owner, assignee)
- `pmo_board_tickets` - Board positions (column_id, position) - normalized!
- `pmo_specs` - Specification documents
- `pmo_subtasks` - Ticket subtasks
- `pmo_ticket_metadata` - Custom key-value metadata

### Key Fields
**Ticket**:
- `id` - Unique identifier (e.g., pmo-ticket-commands-001)
- `status` - Lifecycle state (backlog, ready, in_progress, blocked, review, done, cancelled)
- `owner` - Human responsible for the ticket
- `assignee` - Executor (human or agent)
- `spec_id` - Which spec defined this ticket
- `last_synced_from_spec` - Timestamp for conflict detection
- `last_synced_from_board` - Timestamp for conflict detection

**BoardTicket** (normalized):
- `ticket_id` - Reference to ticket
- `column_id` - Current board column
- `position` - Position within column

---

## Spec-Driven Development

Tickets are defined in spec frontmatter:

```yaml
---
title: PMO Ticket Commands Specification
created: 2024-11-28
tickets:
  - id: pmo-ticket-commands-001
    title: Implement prlt ticket list command
    description: Create command to list all tickets with filtering
    priority: HIGH
    category: feature
  - id: pmo-ticket-commands-002
    title: Implement prlt ticket view command
    description: View detailed ticket information
    priority: HIGH
    category: feature
---
```

Generate tickets from spec:
```bash
prlt spec generate-tickets pmo-ticket-commands
```

---

## Sync Workflow

### Manual Sync
```bash
prlt board sync              # Auto-detect direction
prlt board sync --direction import   # board.md → SQLite
prlt board sync --direction export   # SQLite → board.md
```

### Auto Sync (Watch Mode)
```bash
prlt board watch             # Watches board.md for changes
```

### Conflict Resolution
- Uses timestamps (last_synced_from_spec, last_synced_from_board)
- Last-write-wins strategy
- Shows diff before applying changes

---

## Examples

### Create Ticket from Spec
```bash
# 1. Create spec file with tickets in frontmatter
echo "---
title: Auth System
tickets:
  - id: auth-system-001
    title: Add login screen
    priority: HIGH
---" > specs/active/auth-system.md

# 2. Generate tickets
prlt spec generate-tickets auth-system

# 3. View on board
prlt board view
```

### Bulk Move Tickets
```bash
# Move all "Backlog" high-priority tickets to "Ready"
prlt ticket bulk move --from Backlog --priority HIGH
# (Interactive multi-select interface)
```

### Assign Ticket to Agent
```bash
prlt ticket assign auth-system-001 --to agent:developer
prlt ticket execute auth-system-001
# Spins up developer agent to work on ticket
```

---

## Status

### Implemented
- ✅ Board view/sync/watch commands
- ✅ Ticket create/move/delete
- ✅ Spec create/view/list
- ✅ Spec → Ticket generation
- ✅ Normalized schema (pmo_board_tickets)
- ✅ Sync tracking timestamps

### Not Implemented
- ❌ `prlt ticket list`
- ❌ `prlt ticket view`
- ❌ All bulk operations (move, delete, reassign, update)
- ❌ Work assignment commands (assign, own, claim, execute)
- ❌ Board filtering (--assignee, --priority)

See specs in `specs/active/` for detailed implementation plans.
