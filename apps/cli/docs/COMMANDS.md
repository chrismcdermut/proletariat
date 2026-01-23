# Proletariat CLI Commands Reference

Generated: 2025-11-27

## Table of Contents

- [agent](#agent)
- [agents](#agents)
- [autocomplete](#autocomplete)
- [board](#board)
- [init](#init)
- [plugins](#plugins)
- [pmo](#pmo)
- [project](#project)
- [ticket](#ticket)

---

## agent

### `prlt agent`

Individual agent operations

**Examples:**
```bash
prlt agent status camry
prlt agent visit tacoma
prlt agent add
prlt agent remove camry
```

---

### `prlt agent remove`

Remove a specific agent from the workspace

**Arguments:**
- `name` (optional) - Agent name to remove

**Examples:**
```bash
prlt agent remove camry
prlt agent remove
```

---

### `prlt agent status`

Show detailed status for a specific agent

**Arguments:**
- `name` (optional) - Agent name for detailed status

**Examples:**
```bash
prlt agent status camry
prlt agent status
```

---

### `prlt agent visit`

Navigate to agent directory

**Arguments:**
- `name` (optional) - Agent name to visit

**Examples:**
```bash
prlt agent visit camry
prlt agent visit
```

---

## agents

### `prlt agents`

Manage agents in bulk (overview and batch operations)

**Examples:**
```bash
prlt agents list
prlt agents status
prlt agents add
prlt agents remove
```

---

### `prlt agents add`

Add new agents to the workspace

**Arguments:**
- `names` (optional) - Agent names to add (space-separated)

**Examples:**
```bash
prlt agents add camry tacoma
prlt agents add
```

---

### `prlt agents list`

List all agents and their current status

**Examples:**
```bash
prlt agents list
```

---

### `prlt agents remove`

Remove agents from the workspace

**Arguments:**
- `agents` (optional) - Agent names to remove (space-separated)

**Examples:**
```bash
prlt agents remove camry tacoma
prlt agents remove
```

---

### `prlt agents status`

Show detailed status for specific agent or all agents

**Arguments:**
- `name` (optional) - Agent name for detailed status (optional)

**Examples:**
```bash
prlt agents status camry
prlt agents status
```

---

## autocomplete

### `prlt autocomplete`

Display autocomplete installation instructions.

**Arguments:**
- `shell` (optional) - Shell type

**Flags:**
- -r, `--refresh-cache` - Refresh cache (ignores displaying instructions)

**Examples:**
```bash
$ prlt autocomplete
$ prlt autocomplete bash
$ prlt autocomplete zsh
$ prlt autocomplete powershell
$ prlt autocomplete --refresh-cache
```

---

## board

### `prlt board`

Interactive menu for board operations

**Examples:**
```bash
prlt board
```

---

### `prlt board watch`

Watch board.md for changes and auto-sync to SQLite

**Flags:**
- -d, `--debounce` - Debounce delay in milliseconds

**Examples:**
```bash
prlt board watch
prlt board watch --debounce 1000
```

---

## init

### `prlt init`

Initialize an HQ (headquarters) for managing repositories, agents, and projects

**Examples:**
```bash
prlt init
```

---

## plugins

### `prlt plugins add`

Uses npm to install plugins.

Installation of a user-installed plugin will override a core plugin.

Use the PRLT_NPM_LOG_LEVEL environment variable to set the npm loglevel.
Use the PRLT_NPM_REGISTRY environment variable to set the npm registry.

**Arguments:**
- `plugin` (required) - Plugin to install.

**Flags:**
- `--json` - Format output as json.
- -f, `--force` - Force npm to fetch remote resources even if a local copy exists on disk.
- -h, `--help` - Show CLI help.
- `--jit` - No description
- -s, `--silent` - Silences npm output.
- -v, `--verbose` - Show verbose npm output.

**Examples:**
```bash
```

---

### `prlt plugins inspect`

Displays installation properties of a plugin.

**Arguments:**
- `plugin` (required) - Plugin to inspect.

**Flags:**
- `--json` - Format output as json.
- -h, `--help` - Show CLI help.
- -v, `--verbose` - No description

**Examples:**
```bash
prlt plugins inspect <%- config.pjson.oclif.examplePlugin || "myplugin" %> 
```

---

### `prlt plugins install`

Uses npm to install plugins.

Installation of a user-installed plugin will override a core plugin.

Use the PRLT_NPM_LOG_LEVEL environment variable to set the npm loglevel.
Use the PRLT_NPM_REGISTRY environment variable to set the npm registry.

**Arguments:**
- `plugin` (required) - Plugin to install.

**Flags:**
- `--json` - Format output as json.
- -f, `--force` - Force npm to fetch remote resources even if a local copy exists on disk.
- -h, `--help` - Show CLI help.
- `--jit` - No description
- -s, `--silent` - Silences npm output.
- -v, `--verbose` - Show verbose npm output.

**Examples:**
```bash
```

---

### `prlt plugins link`

Installation of a linked plugin will override a user-installed or core plugin.

e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello' command will override the user-installed or core plugin implementation. This is useful for development work.


**Arguments:**
- `path` (required) - path to plugin

**Flags:**
- -h, `--help` - Show CLI help.
- `--install` - Install dependencies after linking the plugin.
- -v, `--verbose` - No description

**Examples:**
```bash
prlt plugins link <%- config.pjson.oclif.examplePlugin || "myplugin" %> 
```

---

### `prlt plugins remove`

Removes a plugin from the CLI.

**Arguments:**
- `plugin` (optional) - plugin to uninstall

**Flags:**
- -h, `--help` - Show CLI help.
- -v, `--verbose` - No description

**Examples:**
```bash
prlt plugins remove <%- config.pjson.oclif.examplePlugin || "myplugin" %>
```

---

### `prlt plugins reset`

**Flags:**
- `--hard` - No description
- `--reinstall` - No description

---

### `prlt plugins uninstall`

Removes a plugin from the CLI.

**Arguments:**
- `plugin` (optional) - plugin to uninstall

**Flags:**
- -h, `--help` - Show CLI help.
- -v, `--verbose` - No description

**Examples:**
```bash
prlt plugins uninstall <%- config.pjson.oclif.examplePlugin || "myplugin" %>
```

---

### `prlt plugins unlink`

Removes a plugin from the CLI.

**Arguments:**
- `plugin` (optional) - plugin to uninstall

**Flags:**
- -h, `--help` - Show CLI help.
- -v, `--verbose` - No description

**Examples:**
```bash
prlt plugins unlink <%- config.pjson.oclif.examplePlugin || "myplugin" %>
```

---

### `prlt plugins update`

Update installed plugins.

**Flags:**
- -h, `--help` - Show CLI help.
- -v, `--verbose` - No description

---

## pmo

### `prlt pmo init`

Initialize PMO (Project Management Org) in current directory or HQ

**Flags:**
- -s, `--storage` - Storage backend
- -t, `--template` - Board template
- -n, `--name` - Board name

**Examples:**
```bash
prlt pmo init
prlt pmo init --storage git --template scrum
prlt pmo init --storage sqlite --template founder
```

---

## project

### `prlt project create`

Create a new project in the PMO

**Arguments:**
- `name` (optional) - Project name

**Flags:**
- -n, `--name` - Project name
- `--id` - Custom project ID (auto-generated from name if not provided)
- -d, `--description` - Project description
- -t, `--template` - Board template
- -i, `--interactive` - Interactive mode

**Examples:**
```bash
prlt project create "My New Project"
prlt project create --name "Mobile App" --description "iOS and Android app"
prlt project create -i  # Interactive mode
```

---

### `prlt project delete`

Delete a project from the PMO

**Arguments:**
- `id` (optional) - Project ID to delete - prompts with dropdown if not provided

**Flags:**
- -f, `--force` - Skip confirmation prompt

**Examples:**
```bash
prlt project delete my-project
prlt project delete my-project --force
```

---

### `prlt project list`

List all projects in the PMO

**Examples:**
```bash
prlt project list
```

---

### `prlt project view`

View a project's board

**Arguments:**
- `id` (optional) - Project ID to view - prompts with dropdown if not provided

**Examples:**
```bash
prlt project view my-project
prlt project view  # Views default project
```

---

## ticket

### `prlt ticket`

Interactive menu for ticket operations

**Examples:**
```bash
prlt ticket
```

---

### `prlt ticket assign`

Assign ticket to specific user/agent

**Arguments:**
- `ticketId` (optional) - Ticket ID - prompts with dropdown if not provided
- `agent` (optional) - Agent/user to assign - prompts with dropdown if not provided

**Examples:**
```bash
prlt ticket assign TICK-001 alice
prlt ticket assign  # Interactive mode
```

---

### `prlt ticket claim`

Claim a ticket (move from backlog to in-progress)

**Arguments:**
- `ticketId` (optional) - Ticket ID to claim

**Examples:**
```bash
prlt ticket claim T0001
prlt ticket claim
```

---

### `prlt ticket complete`

Mark a ticket as complete (move to done)

**Arguments:**
- `ticketId` (optional) - Ticket ID to complete

**Examples:**
```bash
prlt ticket complete T0001
prlt ticket complete
```

---

### `prlt ticket create`

Create a new ticket on the PMO board

**Flags:**
- -P, `--project` - Project ID (default: "default")
- -t, `--title` - Ticket title
- -c, `--column` - Column to place the ticket in
- -p, `--priority` - Ticket priority
- `--category` - Ticket category (e.g., bug, feature, refactor)
- -d, `--description` - Ticket description
- `--id` - Custom ticket ID (auto-generated if not provided)
- -i, `--interactive` - Interactive mode

**Examples:**
```bash
prlt ticket create
prlt ticket create --title "Fix login bug" --column Backlog
prlt ticket create -t "Add feature" -c "In Progress" -p HIGH
prlt ticket create --project mobile-app -t "New feature"
```

---

### `prlt ticket delete`

Delete a ticket permanently

**Arguments:**
- `ticketId` (optional) - Ticket ID to delete - prompts with dropdown if not provided

**Flags:**
- -f, `--force` - Skip confirmation prompt

**Examples:**
```bash
prlt ticket delete TICK-001
prlt ticket delete TICK-001 --force
prlt ticket delete  # Interactive mode
```

---

### `prlt ticket list`

List tickets from the PMO board

**Flags:**
- -P, `--project` - Project ID (default: "default")
- -c, `--column` - Filter by column
- -p, `--priority` - Filter by priority
- `--category` - Filter by category
- -s, `--search` - Search in title and description
- -f, `--format` - Output format
- -a, `--all` - Show all columns (including Done)

**Examples:**
```bash
prlt ticket list
prlt ticket list --column Backlog
prlt ticket list --priority URGENT
prlt ticket list --category bug
prlt ticket list --search "login"
prlt ticket list --project mobile-app
```

---

### `prlt ticket move`

Move a ticket to a different column

**Arguments:**
- `ticketId` (optional) - Ticket ID - prompts with dropdown if not provided
- `column` (optional) - Target column - prompts with dropdown if not provided

**Flags:**
- `--position` - Position within the column (0 = top)

**Examples:**
```bash
prlt ticket move my-ticket "In Progress"
prlt ticket move implement-auth Done
prlt ticket move fix-bug "In Review" --position 0
```

---

### `prlt ticket status`

Update ticket status (move between board columns)

**Arguments:**
- `ticketId` (required) - Ticket ID
- `status` (required) - New status
- `reason` (optional) - Reason for status change (for blocked)

**Examples:**
```bash
prlt ticket status T0001 in-review
prlt ticket status T0001 blocked "Waiting for API"
```

---

### `prlt ticket view`

View detailed ticket information

**Arguments:**
- `ticketId` (optional) - Ticket ID to view - prompts with dropdown if not provided

**Examples:**
```bash
prlt ticket view TICK-001
prlt ticket view  # Interactive mode
```

---

