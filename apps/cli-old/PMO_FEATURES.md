# PMO (Project Management Office) Features

## Overview

Proletariat CLI now includes integrated PMO functionality for managing tickets, kanban boards, and seamless Claude AI integration.

## New Commands

### PMO Initialization
```bash
prlt pmo:init
```
Initializes a Project Management Office with:
- Kanban board (5-tool-founder queues)
- Ticket specs directory structure
- Optional git repository for PMO

### Create Tickets
```bash
prlt add
prlt create  # alias
```
Interactive ticket creation with:
- **5-Tool-Founder Queues**: Build, Grow, Support, BizOps, Strategy
- **Fibonacci Points**: 1, 2, 3, 5, 8, 13, 21
- **Eisenhower Matrix**: Priority (P0-P3) and Urgency (U0-U3)
- **Rich descriptions** via editor
- Automatic kanban board updates

### Claim Tickets
```bash
prlt claim              # Interactive selection
prlt claim <ticket-id>  # Direct claim
```
Claiming a ticket:
1. Shows available tickets from backlog
2. Updates ticket status to "In Progress"
3. Creates feature branch: `feature/<ticket-id>`
4. **Launches Claude CLI with full context**

### Switch to Agent Workspace
```bash
prlt go <agent>
prlt switch <agent>  # alias
```
Quickly switch between agent worktrees.

## Claude Integration

When you claim a ticket, Proletariat automatically:

1. **Prepares Context**: Creates a markdown file with:
   - Agent identity
   - Ticket specifications
   - Acceptance criteria
   - Branch information
   - Project structure

2. **Launches Claude CLI**: 
   ```bash
   claude < /tmp/prlt-claude-context.md
   ```

3. **Claude receives**:
   - Full ticket requirements
   - Your role as specific agent
   - Current branch context
   - Ready-to-code environment

## Workflow Example

```bash
# 1. Initialize PMO
prlt pmo:init

# 2. Create a ticket
prlt add
# Interactive prompts:
#   - ID: implement-oauth
#   - Queue: Build
#   - Points: 5
#   - Priority: P1
#   - Urgency: U1

# 3. Claim and start work
prlt claim implement-oauth
# This will:
#   ✓ Assign ticket to you
#   ✓ Create branch: feature/implement-oauth
#   ✓ Launch Claude with context

# 4. Claude opens with:
"You are agent 4runner working on ticket implement-oauth..."
# Full spec, requirements, and instructions loaded
```

## Directory Structure

```
project/
├── .proletariat/
│   └── repo.json
├── pmo/
│   ├── kanban.md          # 5-tool-founder board
│   └── specs/
│       ├── backlog/       # New tickets
│       ├── active/        # In progress
│       └── completed/     # Done
└── [your code]
```

## 5-Tool-Founder Queues

- **🏗️ Build**: Product features & engineering
- **📈 Grow**: Growth, marketing & user acquisition
- **🛟 Support**: Customer success & operations
- **⚙️ BizOps**: Business operations & infrastructure
- **🎯 Strategy**: Strategic planning & vision

## Eisenhower Matrix

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

## Installation

```bash
# Install/update Proletariat CLI
npm install -g @proletariat/cli

# Initialize in your project
cd your-project
prlt init
prlt pmo:init

# Start creating and claiming tickets!
prlt add
prlt claim
```

## Requirements

- Node.js >= 16
- Git repository
- Claude CLI (optional, for AI integration)
  - Install from: https://claude.ai/download

## Benefits

1. **Structured Workflow**: Consistent ticket management across agents
2. **AI-First Development**: Seamless Claude integration
3. **Parallel Development**: Multiple agents working simultaneously
4. **Clear Prioritization**: Eisenhower matrix for decision making
5. **Themed Workspaces**: Fun, memorable agent names

## Coming Soon

- [ ] PR creation with ticket linkage
- [ ] Ticket dependencies
- [ ] Sprint planning
- [ ] Velocity tracking
- [ ] Multi-repo ticket synchronization

## Support

Report issues: https://github.com/chrismcdermut/proletariat-cli/issues