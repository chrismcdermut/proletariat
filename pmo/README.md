# PMO (Project Management Office)

## Storage: SQLite
## Template: founder

## Structure
- **projects/{id}/board.md** - Kanban boards (Obsidian compatible, auto-synced with database)
- **projects/{id}/specs/** - Detailed specifications for tickets (active, complete, future, dropped)
- Data stored in `../.proletariat/workspace.db` (pmo_* tables)

## Commands
```bash
# Create ticket
prlt ticket create --title "My ticket" --column "Backlog"

# List tickets
prlt ticket list
prlt ticket list --column "In Progress"
prlt ticket list --priority URGENT

# Move ticket
prlt ticket move <ticket-id> "In Progress"

# Update ticket
prlt ticket update <ticket-id> --priority HIGH

# View/manage specs
prlt spec list
prlt spec create
prlt spec view <spec-id>
prlt spec generate-tickets <spec-id>
```

## Obsidian Setup
1. Open this folder as an Obsidian vault
2. Install the "Kanban" plugin
3. Open board.md and switch to Kanban view
