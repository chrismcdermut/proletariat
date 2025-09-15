# Proletariat Component Architecture & Naming

## Core Architecture (Soviet Theme)

The state machine company runs on these four essential components:

```
┌─────────────────────────────────────────────────────┐
│                   SWITCHBOARD                       │
│         (Incoming Communication Mapper)             │
│    SMS, Slack, Email → Normalized Commands          │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                   POLITBURO                         │
│              (Orchestrator/Brain)                   │
│    Routes commands, makes decisions, assigns work   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                    GOSPLAN                          │
│                  (PMO Board)                        │
│    Strategic planning, specs, kanban state          │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                  PROLETARIAT                        │
│              (Execution Workforce)                  │
│    Billionaire agents doing the actual work         │
└─────────────────────────────────────────────────────┘
```

## Package Structure

```
/proletariat
├── /packages
│   ├── switchboard/          # @proletariat/switchboard
│   │   └── src/
│   │       ├── adapters/    # SMS, Slack, Email adapters
│   │       ├── parser/      # Command parsing
│   │       └── router/      # Route to Politburo
│   │
│   ├── politburo/           # @proletariat/politburo
│   │   └── src/
│   │       ├── decisions/   # Decision engine
│   │       ├── assignments/ # Work assignment
│   │       └── monitor/     # Agent monitoring
│   │
│   ├── gosplan/             # @proletariat/gosplan
│   │   └── src/
│   │       ├── kanban/      # Kanban board state
│   │       ├── specs/       # Spec management
│   │       └── reports/     # Status reports
│   │
│   └── cli/                 # @proletariat/cli (current)
│       └── src/
│           └── workforce/   # Agent management
```

## Component Responsibilities

### SWITCHBOARD (Incoming Communication Mapper)
**Purpose:** Universal input layer that normalizes all communication
```typescript
// All inputs become normalized Directives
interface Directive {
  source: 'sms' | 'slack' | 'email' | 'cli';
  sender: string;
  command: string;
  params: Record<string, any>;
  timestamp: Date;
}

// Examples:
"bezos, implement analytics" → 
{
  command: 'assign',
  params: { agent: 'bezos', task: 'implement analytics' }
}
```

### POLITBURO (Orchestrator)
**Purpose:** Decision-making brain that routes work
```typescript
interface Resolution {
  directive: Directive;
  decision: 'assign' | 'defer' | 'reject' | 'clarify';
  assignment?: {
    agent: string;
    mandate: string;  // Work order
    deadline?: Date;
  };
}

// Makes decisions based on:
// - Agent availability
// - Current workload
// - Priority
// - Dependencies
```

### GOSPLAN (PMO Board)
**Purpose:** Strategic planning and state tracking
```typescript
interface FiveYearPlan {  // OKR level
  campaigns: Campaign[];   // Initiatives
  quotas: Quota[];        // Measurable outputs
}

interface Campaign {       // Initiative
  mandates: Mandate[];    // Mid-level work
  status: 'planned' | 'active' | 'complete';
}

// The source of truth for company state
// Markdown files in /pmo/
```

### PROLETARIAT (Execution Workforce)
**Purpose:** The actual workers (git worktrees with AI agents)
```typescript
interface Worker {
  name: 'bezos' | 'musk' | 'gates';
  status: 'idle' | 'working' | 'blocked';
  currentMandate?: Mandate;
  workspace: string;  // Git worktree path
}

// Each worker:
// - Has a git worktree
// - Runs AI agents (Claude, Copilot)
// - Reports status back to Politburo
```

## Data Flow Example

```
1. SMS arrives: "bezos, add dark mode"
   ↓
2. SWITCHBOARD parses into Directive
   ↓
3. POLITBURO receives Directive, checks GOSPLAN
   ↓
4. POLITBURO creates Resolution: assign to bezos
   ↓
5. GOSPLAN updates kanban (mandate created)
   ↓
6. PROLETARIAT (bezos) receives mandate, starts work
   ↓
7. PROLETARIAT reports completion
   ↓
8. GOSPLAN updates state
   ↓
9. SWITCHBOARD sends SMS: "Dark mode complete"
```

## Alternative Naming (If Soviet Theme Is Too Strong)

**Neutral/Professional:**
- Switchboard → Switchboard (keep it, perfect)
- Politburo → Orchestrator
- Gosplan → Planner
- Proletariat → Workforce

**Journey Theme:**
- Switchboard → Basecamp
- Politburo → Command Tent
- Gosplan → Route Planner
- Proletariat → Expedition Team

## Why This Architecture Works

1. **Clear separation**: Each component has one job
2. **Scalable**: Add more workers, more input channels
3. **Testable**: Mock any component
4. **Theme-able**: Swap names without changing architecture
5. **Git-native**: Everything is files and commits

## Implementation Priority

1. **First**: CLI (Proletariat) - Already exists ✅
2. **Second**: Gosplan (PMO) - Just markdown files
3. **Third**: Switchboard - Start with SMS
4. **Fourth**: Politburo - Simple assignment logic
5. **Future**: Pravda (reports), Secretariat (scheduling)

This architecture makes your "company as state machine" concept concrete and implementable.