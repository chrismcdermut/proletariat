---
title: PMO Spec Commands Specification
created: 2024-11-28
---

# PMO Spec Commands Specification

> **Note**: For work management (epics, progress, lifecycle), see [pmo-epic-commands.md](pmo-epic-commands.md)

## Overview

Spec commands handle specification documents. Specs are **static markdown files** that describe features, designs, or architecture. They are documentation - not work management.

**Key Distinction**:
- **Specs** = static documents (design docs, requirements, architecture) - no lifecycle, no tickets
- **Epics** = work containers with status and tickets - see [pmo-epic-commands.md](pmo-epic-commands.md)

**Core Concepts**:

- Specs are markdown files with YAML frontmatter
- Specs are pure documentation (no ticket definitions)
- Specs are organized in folders by type (not status)
- Specs belong to projects

## Command Overview

| Command                    | Purpose                              | Status         |
| -------------------------- | ------------------------------------ | -------------- |
| `prlt spec`                | Interactive menu for spec operations | ✅ Implemented |
| `prlt spec create [name]`  | Create new spec document             | ✅ Implemented |
| `prlt spec list`           | List all specs                       | ✅ Implemented |
| `prlt spec view [id]`      | View spec content                    | ✅ Implemented |

---

## Command Specifications

### `prlt spec`

**Purpose**: Interactive menu for spec document operations

**Interactive Flow**:

```
? 📄 Spec Operations - What would you like to do?
  ❯ Create new spec
    List all specs
    View spec
    ─────────
    Cancel
```

**Example**:

```bash
prlt spec
```

**Behavior**:

- Shows menu of all spec operations
- Runs selected command
- Returns to menu on completion

---

### `prlt spec create [name]`

**Purpose**: Create a new spec document with template

**Arguments**:

- `name` (optional): Spec name (will prompt if not provided)

**Options**:

- `--name, -n <name>`: Spec name
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--template, -t <template>`: Template type (feature, architecture, api)

**Interactive Flow**:

```
? Spec name: User Authentication Design
? Template:
  ❯ Feature (default)
    Architecture
    API

✅ Created spec "User Authentication Design"
  Project: proletariat
  File: pmo/projects/proletariat/specs/user-authentication-design.md
```

**Example**:

```bash
prlt spec create "User Authentication Design"
prlt spec create --name "API Design" --template api
```

**Behavior**:

- Creates markdown file in specs/ directory
- Adds YAML frontmatter with metadata (title, created)
- Includes template sections based on type
- Auto-slugifies filename from spec name
- Checks for existing spec before creating

**Template Structure**:

```markdown
---
title: User Authentication Design
created: 2025-11-28T...
---

# User Authentication Design

## Overview
[Describe what this spec covers and why it's important]

## Goals
- Goal 1
- Goal 2

## Design
[Describe the approach, architecture, or implementation plan]

## Alternatives Considered
[Other approaches that were evaluated]

## References
- [Link to related docs]
```

---

### `prlt spec list`

**Purpose**: List all spec documents

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Example**:

```bash
prlt spec list
prlt spec list --project mobile-app
```

**Output**:

```
📄 Specs - proletariat
═══════════════════════════════════════════════════

  user-authentication-design: User Authentication Design
     pmo/projects/proletariat/specs/user-authentication-design.md
  api-design: API Design
     pmo/projects/proletariat/specs/api-design.md
  payment-architecture: Payment Architecture
     pmo/projects/proletariat/specs/payment-architecture.md

═══════════════════════════════════════════════════
Total: 3 specs

Commands:
  prlt spec create    Create a new spec
  prlt spec view <id> View spec details
```

**Behavior**:

- Lists all specs in project
- Displays relative file paths

---

### `prlt spec view [id]`

**Purpose**: View spec document content

**Arguments**:

- `id` (optional): Spec ID (filename without .md) - prompts if not provided

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--full, -f`: Show full spec content (default: summary only)

**Example**:

```bash
prlt spec view user-authentication-design
prlt spec view --full
```

**Output** (without --full):

```
📄 Spec: User Authentication Design
═══════════════════════════════════════════════════
ID: user-authentication-design
Project: proletariat
Created: 11/28/2025
File: pmo/projects/proletariat/specs/user-authentication-design.md

## Overview
OAuth2-based authentication system with support for
social login providers...

═══════════════════════════════════════════════════
To view full content, add --full flag
```

**Output** (with --full):

```
[Same header as above]

═══════════════════════════════════════════════════

📝 Content:

[Full markdown content of the spec file]
```

**Behavior**:

- Shows spec metadata from frontmatter
- Displays overview section by default
- Full content with --full flag

---

## Design Principles

### Specs as Documentation

- Specs are static design documents
- No lifecycle status (use epics for that)
- No ticket definitions (use epics for that)
- Focus on the "what" and "why"

### Folder Organization

```
pmo/projects/{projectId}/specs/
├── user-authentication-design.md
├── api-design.md
├── payment-architecture.md
└── ...
```

### Spec vs Epic

| Aspect | Spec | Epic |
|--------|------|------|
| Purpose | Documentation | Work container |
| Status | None | active, draft, complete, etc. |
| Tickets | None | Defines tickets in frontmatter |
| Progress | N/A | Tracked via ticket completion |
| Lifecycle | Static | Moves through statuses |

---

## Future Enhancements

### Spec Templates

```bash
prlt spec create --template feature
prlt spec create --template architecture
prlt spec create --template api
prlt spec create --template rfc
```

### Spec Search

```bash
prlt spec search "authentication"
```

### Spec Export

```bash
prlt spec export user-authentication-design --format pdf
```
