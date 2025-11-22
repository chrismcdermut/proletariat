# Proletariat CLI - Complete Command Reference

## Command Categories

### 1. 🏗️ Setup & Configuration

| Command | Description | Options/Args | Example |
|---------|-------------|--------------|---------|
| `prlt init` | Initialize workspace management | `--theme`, `--hq`, `--workspace-root` | `prlt init --hq MyCompany` |
| `prlt upgrade` | Upgrade config to latest version | none | `prlt upgrade` |
| `prlt migrate <hq-name>` | Migrate repo into HQ structure | `<hq-name>` | `prlt migrate MyCompany` |

### 2. 👥 Agent Management (Standard Commands)

| Command | Description | Options/Args | Example |
|---------|-------------|--------------|---------|
| `prlt agent` | Interactive agent management menu | none | `prlt agent` |
| `prlt agent add [names...]` | Create new agents | `[names...]` | `prlt agent add musk bezos` |
| `prlt agent remove [names...]` | Remove agents | `[names...]` | `prlt agent remove gates` |
| `prlt agent list` | Show all agents and status | none | `prlt agent list` |
| `prlt agent grant` | Give agent access to repos | none (interactive) | `prlt agent grant` |
| `prlt agent revoke` | Remove agent access to repos | none (interactive) | `prlt agent revoke` |
| `prlt agent switch <name>` | Navigate to agent workspace | `<name>` | `prlt agent switch bezos` |

### 3. 📦 Repository Management

| Command | Description | Options/Args | Example |
|---------|-------------|--------------|---------|
| `prlt repo` | Interactive repo management | none | `prlt repo` |
| `prlt repo add [path]` | Add repo to HQ | `[path]` | `prlt repo add frontend` |
| `prlt repo remove [name]` | Remove repo from HQ | `[name]` | `prlt repo remove backend` |
| `prlt repo list` | Show all repos | none | `prlt repo list` |
| `prlt add [path]` | Alias for `repo add` | `[path]` | `prlt add ./my-repo` |

### 4. 🎯 Ticket/PMO Management

| Command | Description | Options/Args | Example |
|---------|-------------|--------------|---------|
| `prlt pmo:init` | Initialize PMO | none | `prlt pmo:init` |
| `prlt ticket` | Interactive ticket menu | none | `prlt ticket` |
| `prlt ticket create` | Create new ticket | none (interactive) | `prlt ticket create` |
| `prlt ticket claim [id]` | Claim ticket for work | `[id]` | `prlt ticket claim TKT-001` |
| `prlt ticket complete <id>` | Mark ticket done | `<id>` | `prlt ticket complete TKT-001` |
| `prlt ticket list` | Show all tickets | none | `prlt ticket list` |
| `prlt add-ticket` | Alias for `ticket create` | none | `prlt add-ticket` |
| `prlt create-ticket` | Alias for `ticket create` | none | `prlt create-ticket` |
| `prlt claim [id]` | Alias for `ticket claim` | `[id]` | `prlt claim TKT-001` |

### 5. 💰 Billionaires Theme Commands (Aliases)

| Command | Description | Maps To | Example |
|---------|-------------|---------|---------|
| `prlt hire [names...]` | Hire billionaire agents | `agent add` | `prlt hire bezos musk` |
| `prlt fire [names...]` | Fire billionaire agents | `agent remove` | `prlt fire gates` |
| `prlt staff` | Show billionaire staff | `agent list` | `prlt staff` |

### 6. 🚗 Cars Theme Commands (Aliases)

| Command | Description | Maps To | Example |
|---------|-------------|---------|---------|
| `prlt drive [names...]` | Drive car agents | `agent add` | `prlt drive camry prius` |
| `prlt park [names...]` | Park car agents | `agent remove` | `prlt park tacoma` |
| `prlt garage` | Show car garage | `agent list` | `prlt garage` |

### 7. 🏢 Companies Theme Commands (Aliases)

| Command | Description | Maps To | Example |
|---------|-------------|---------|---------|
| `prlt buy [names...]` | Buy company agents | `agent add` | `prlt buy apple google` |
| `prlt sell [names...]` | Sell company agents | `agent remove` | `prlt sell netflix` |
| `prlt portfolio` | Show company portfolio | `agent list` | `prlt portfolio` |

### 8. 🔧 Maintenance & Utilities

| Command | Description | Options/Args | Example |
|---------|-------------|--------------|---------|
| `prlt repair` | Fix broken worktree references | none | `prlt repair` |
| `prlt health` | Check worktree health | none | `prlt health` |
| `prlt access` | Manage agent repository access | none (interactive) | `prlt access` |
| `prlt go <agent>` | Switch to agent workspace | `<agent>` | `prlt go bezos` |
| `prlt switch <agent>` | Alias for `go` | `<agent>` | `prlt switch musk` |

### 9. 📋 Information Commands

| Command | Description | Options/Args | Example |
|---------|-------------|--------------|---------|
| `prlt list` | List available agents | `--theme` | `prlt list --theme=cars` |
| `prlt themes` | Show all available themes | none | `prlt themes` |
| `prlt --version` | Show CLI version | none | `prlt --version` |
| `prlt --help` | Show help | none | `prlt --help` |

## Command Patterns

### Interactive vs Direct Mode
Most commands support both modes:
- **Interactive**: `prlt agent` → Shows menu
- **Direct**: `prlt agent add bezos` → Executes immediately

### Standard vs Theme Commands
- **Standard**: `prlt agent add` - Works regardless of theme
- **Theme**: `prlt hire` - Theme-specific alias for fun

### HQ vs Simple Mode
Commands adapt based on context:
- **HQ Mode**: Full multi-repo support with agent access control
- **Simple Mode**: Basic worktree management for single repo

## Usage Examples

### Setting Up a New Project
```bash
# Initialize with HQ
prlt init --hq MyCompany

# Add repositories
prlt repo add frontend
prlt repo add backend

# Hire agents
prlt hire bezos musk gates

# Grant access
prlt agent grant  # Interactive: select agents and repos
```

### Daily Workflow
```bash
# Check status
prlt staff  # or prlt agent list

# Switch to workspace
prlt go bezos
cd ../MyCompany/.proletariat/agents/staff/bezos

# Create ticket
prlt ticket create

# Claim and work on ticket
prlt claim TKT-001

# Complete ticket
prlt ticket complete TKT-001
```

### Maintenance
```bash
# After moving repo
prlt repair

# Check health
prlt health

# Upgrade config
prlt upgrade
```

## Notes

1. **Theme Persistence**: Once initialized with a theme, all theme commands become available
2. **Backwards Compatibility**: Old commands like `add-ticket` still work
3. **Context Aware**: Commands detect HQ vs simple mode automatically
4. **Interactive Fallback**: Most commands prompt for missing arguments