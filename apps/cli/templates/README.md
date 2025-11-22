# Proletariat PMO Templates

This directory contains all the templates used by the Proletariat PMO system.

## Template Files

### `kanban-template.md`
**Purpose**: Base template for creating new kanban boards
**Used by**: `prlt pmo:init` command
**Features**:
- 5-tool-founder queue structure
- Build, Grow, Support, BizOps, Strategy queues
- Standard workflow columns (Triage → In Progress → Done)
- Obsidian kanban plugin configuration

### `ticket-template.md`
**Purpose**: Template structure for ticket specifications
**Used by**: `prlt add` command
**Variables**:
- `{{TITLE}}` - Ticket title
- `{{ID}}` - Unique ticket identifier
- `{{STATUS}}` - Current status (Backlog, In Progress, etc.)
- `{{QUEUE}}` - 5-tool-founder queue assignment
- `{{POINTS}}` - Fibonacci story points
- `{{PRIORITY}}` - P0-P3 priority level
- `{{URGENCY}}` - U0-U3 urgency level
- `{{DESCRIPTION}}` - Detailed description
- `{{AGENT}}` - Assigned agent name

### `example-board.md`
**Purpose**: Example kanban board with sample tickets
**Shows**:
- Real ticket examples across all queues
- Proper ticket naming conventions
- Priority/urgency combinations
- Agent assignments
- Ticket progression through workflow

### `example-ticket.md`
**Purpose**: Complete example of a ticket specification
**Demonstrates**:
- Full ticket lifecycle from creation to completion
- Progress logging format
- Acceptance criteria structure
- Technical notes organization
- Resource tracking
- Definition of done checklist

## Customization

You can modify these templates to fit your team's workflow:

1. **Add custom queues**: Modify the kanban template queues
2. **Change ticket fields**: Add/remove metadata fields in ticket template
3. **Update workflows**: Modify the kanban columns
4. **Customize validation**: Update acceptance criteria format

## Queue Descriptions

- **🏗️ Build**: Product features & engineering work
- **📈 Grow**: Growth, marketing & user acquisition
- **🛟 Support**: Customer success & operational improvements  
- **⚙️ BizOps**: Business operations & infrastructure
- **🎯 Strategy**: Strategic planning & vision work

## Priority Matrix (Eisenhower)

**Priority (Importance)**:
- P0: Critical/Blocker
- P1: High/Important  
- P2: Medium/Normal
- P3: Low/Nice-to-have

**Urgency (Time-sensitive)**:
- U0: Immediate/Emergency
- U1: This week
- U2: This sprint  
- U3: Backlog

## Story Points (Fibonacci)

- 1: Trivial change
- 2: Small feature
- 3: Medium feature
- 5: Large feature
- 8: Epic feature
- 13: Major project
- 21: Massive initiative

## Template Usage in Code

Currently templates are embedded in the TypeScript code. Future versions will load from these template files for easier customization.

## Related Files

- `src/lib/pmo/index.ts` - PMO implementation
- `src/bin/prlt.ts` - CLI command definitions