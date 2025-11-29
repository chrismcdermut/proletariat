# PMO (Project Management Office)

## Storage: sqlite
## Template: founder

## Structure
- **projects/{id}/board.md** - Kanban boards (Obsidian compatible, auto-synced with database)
- **projects/{id}/specs/** - Detailed specifications for tickets (active, complete, future, dropped)
- Data stored in `../.proletariat/workspace.db` (pmo_* tables)

## Commands
```bash
# View board
prlt board view

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


```


