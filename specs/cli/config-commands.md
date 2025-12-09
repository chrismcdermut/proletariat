# Config Commands Specification

## Purpose

Commands for managing CLI configuration settings. Configuration is stored in the workspace SQLite database (`workspace_settings` table).

## Command Overview

| Command                            | Purpose                          | Status             |
| ---------------------------------- | -------------------------------- | ------------------ |
| `prlt config get <key>`            | Get a configuration value        | ⬜ Not Implemented |
| `prlt config set <key> <value>`    | Set a configuration value        | ⬜ Not Implemented |
| `prlt config list`                 | List all configuration settings  | ⬜ Not Implemented |
| `prlt config reset <key>`          | Reset a setting to default       | ⬜ Not Implemented |

---

## Configuration Keys

### Execution Settings

| Key                        | Description                           | Default         | Valid Values                                           |
| -------------------------- | ------------------------------------- | --------------- | ------------------------------------------------------ |
| `execution.default_mode`   | Default runtime mode for agents       | `terminal`      | foreground, background, tmux, terminal, docker, vm     |
| `execution.default_executor` | Default coding agent                | `claude-code`   | claude-code, codex, aider, custom                      |
| `execution.terminal.app`   | Terminal app for `terminal` mode      | (prompted)      | iTerm, Ghostty, WezTerm, Kitty, Alacritty, Terminal    |
| `execution.shell`          | Shell to use for commands             | `zsh`           | bash, zsh, fish                                        |
| `execution.auto_execute`   | Auto-execute on claim                 | `false`         | true, false                                            |

### Tmux Settings

| Key                        | Description                           | Default         | Valid Values       |
| -------------------------- | ------------------------------------- | --------------- | ------------------ |
| `execution.tmux.session`   | Tmux session name                     | `proletariat`   | any string         |
| `execution.tmux.layout`    | New window or split pane              | `window`        | window, split      |

### Docker Settings

| Key                        | Description                           | Default                    | Valid Values   |
| -------------------------- | ------------------------------------- | -------------------------- | -------------- |
| `execution.docker.image`   | Docker image for agent containers     | `proletariat/agent:latest` | any image name |
| `execution.docker.network` | Docker network mode                   | `bridge`                   | bridge, host   |
| `execution.docker.memory`  | Memory limit                          | `4g`                       | Docker memory format |
| `execution.docker.cpus`    | CPU limit                             | `2`                        | number         |

### VM Settings

| Key                        | Description                           | Default                | Valid Values   |
| -------------------------- | ------------------------------------- | ---------------------- | -------------- |
| `execution.vm.default_host`| Default VM host for remote execution  | -                      | hostname       |
| `execution.vm.user`        | SSH user for VM connections           | `agent`                | username       |
| `execution.vm.key_path`    | SSH key path                          | `~/.ssh/agent_key`     | file path      |

---

## Command Specifications

### `prlt config get <key>`

**Purpose**: Get a configuration value

**Arguments**:
- `key` (required): Configuration key (e.g., `execution.terminal.app`)

**Example**:
```bash
prlt config get execution.terminal.app
# Output: iTerm2

prlt config get execution.default_mode
# Output: terminal
```

**Behavior**:
- Reads from `workspace_settings` table
- Returns raw value (no formatting)
- Returns empty/error if key not set

---

### `prlt config set <key> <value>`

**Purpose**: Set a configuration value

**Arguments**:
- `key` (required): Configuration key
- `value` (required): Value to set

**Example**:
```bash
prlt config set execution.terminal.app Ghostty
# ✅ Set execution.terminal.app = Ghostty

prlt config set execution.default_mode background
# ✅ Set execution.default_mode = background
```

**Behavior**:
- Validates key against known configuration keys
- Validates value against allowed values (if applicable)
- Stores in `workspace_settings` table
- Creates key if it doesn't exist

---

### `prlt config list`

**Purpose**: List all configuration settings

**Options**:
- `--all, -a`: Show all settings including defaults
- `--category <name>`: Filter by category (execution, tmux, docker, vm)

**Example**:
```bash
prlt config list
```

**Output**:
```
📋 Configuration Settings

Execution
  execution.terminal.app     = iTerm2
  execution.default_mode     = terminal
  execution.default_executor = claude-code

Tmux
  execution.tmux.session     = proletariat (default)
  execution.tmux.layout      = window (default)

Docker
  (using defaults)

VM
  (not configured)
```

**Behavior**:
- Groups settings by category
- Shows (default) indicator for unset values
- Shows actual stored values

---

### `prlt config reset <key>`

**Purpose**: Reset a setting to its default value

**Arguments**:
- `key` (required): Configuration key to reset

**Options**:
- `--all`: Reset all settings to defaults

**Example**:
```bash
prlt config reset execution.terminal.app
# ✅ Reset execution.terminal.app to default

prlt config reset --all
# ⚠️  This will reset all settings. Continue? [y/N]
# ✅ All settings reset to defaults
```

**Behavior**:
- Removes key from `workspace_settings` table
- Next access will use default value
- `--all` requires confirmation

---

## Database Schema

```sql
-- Already exists in workspace.db
CREATE TABLE IF NOT EXISTS workspace_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Alternative Ways to Configure

Some settings can also be configured through flags:

### Terminal App
```bash
# Via config command (when implemented)
prlt config set execution.terminal.app Ghostty

# Via ticket execute --reconfigure flag
prlt ticket execute TKT-001 --mode terminal --reconfigure
```

### Runtime Mode
```bash
# Via config command (when implemented)
prlt config set execution.default_mode background

# Via ticket execute --mode flag (per-execution override)
prlt ticket execute TKT-001 --mode tmux
```

---

## Future Enhancements

### Interactive Config
```bash
prlt config
# ? What would you like to configure?
#   ❯ Terminal app
#     Default runtime mode
#     Default executor
#     Tmux settings
#     Docker settings
#     VM settings
```

### Config Profiles
```bash
prlt config profile create local-dev
prlt config profile use local-dev
prlt config profile list
```

### Config Export/Import
```bash
prlt config export > config.json
prlt config import config.json
```
