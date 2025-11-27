# Proletariat PMO Templates

Organized template system for the Proletariat PMO (Project Management Office) feature.

## Directory Structure

```
templates/
├── boards/                    # Kanban board templates
│   ├── kanban-template.md     # Basic kanban board template
│   ├── kanban-pmo.md          # PMO-specific kanban template
│   └── examples/              # Board examples
│       └── example-board.md   # Fully populated board example
│
└── tickets/                   # Ticket templates
    ├── ticket-template.md     # Basic ticket template
    ├── ticket-pmo.md          # PMO-specific ticket template
    └── examples/              # Ticket examples
        └── example-ticket.md  # Complete ticket example
```

## Board Templates

### `boards/kanban-template.md`
**Purpose**: Base template for creating new kanban boards
**Used by**: `prlt pmo:init` command
**Features**:
- Standard workflow columns (Triage → In Progress → Done)
- Obsidian kanban plugin configuration
- Clean starting point

### `boards/kanban-pmo.md`
**Purpose**: PMO-specific kanban with 5-tool-founder queues
**Features**:
- Build, Grow, Support, BizOps, Strategy queues
- Pre-configured for PMO workflow
- Eisenhower matrix integration

### `boards/examples/example-board.md`
**Purpose**: Example kanban board with sample tickets
**Shows**:
- Real ticket examples across all queues
- Proper ticket naming conventions
- Priority/urgency combinations
- Agent assignments
- Ticket progression through workflow

## Ticket Templates

### `tickets/ticket-template.md`
**Purpose**: Basic ticket structure
**Variables**:
- `{{TITLE}}` - Ticket title
- `{{ID}}` - Unique ticket identifier
- `{{STATUS}}` - Current status
- `{{DESCRIPTION}}` - Detailed description

### `tickets/ticket-pmo.md`
**Purpose**: Full PMO ticket specification
**Variables**:
- `{{QUEUE}}` - 5-tool-founder queue assignment
- `{{POINTS}}` - Fibonacci story points
- `{{PRIORITY}}` - P0-P3 priority level
- `{{URGENCY}}` - U0-U3 urgency level
- `{{AGENT}}` - Assigned agent name
- Plus all basic ticket fields

### `tickets/examples/example-ticket.md`
**Purpose**: Complete example of a ticket specification
**Demonstrates**:
- Full ticket lifecycle from creation to completion
- Progress logging format
- Acceptance criteria structure
- Technical notes organization
- Resource tracking
- Definition of done checklist

## Queue System (5-Tool-Founder)

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

- 1: Trivial change (< 1 hour)
- 2: Small feature (2-4 hours)
- 3: Medium feature (1 day)
- 5: Large feature (2-3 days)
- 8: Epic feature (1 week)
- 13: Major project (2 weeks)
- 21: Massive initiative (1 month+)

## Usage in CLI

```bash
# Initialize PMO with templates
prlt pmo:init

# Create new ticket (uses ticket template)
prlt ticket create

# Initialize HQ with PMO templates
prlt init --hq MyCompany
```

## Customization

You can modify these templates to fit your workflow:

1. **Custom queues**: Edit kanban-pmo.md to add/remove queues
2. **Ticket fields**: Modify ticket templates for your metadata
3. **Workflow columns**: Change kanban column structure
4. **Examples**: Add more examples for your use cases

## Implementation Files

- `src/lib/pmo/index.ts` - PMO implementation
- `src/lib/managers/TicketManager.ts` - Ticket management
- `src/bin/prlt.ts` - CLI command definitions

## Future Enhancements

- [ ] Dynamic template loading (currently embedded in code)
- [ ] Custom template directories
- [ ] Template validation
- [ ] Template variables expansion
- [ ] Multi-language templates