# Proletariat Orchestration Architecture

## System Overview

Proletariat evolves from a simple git worktree manager to a distributed task orchestration system with autonomous agents, PMO integration, and multi-channel communication.

## Core Components

### 1. Orchestrator Agent (The Central Committee)
**Location**: `packages/orchestrator`
**Responsibilities**:
- Reads specs from PMO directory
- Parses requirements and breaks down into tasks
- Assigns tasks to available worker agents
- Monitors progress and handles reassignment
- Maintains global task queue and state

### 2. Worker Agents (The Proletariat)
**Location**: `packages/worker`
**Responsibilities**:
- Register with orchestrator on startup
- Claim tasks from queue based on capabilities
- Execute tasks in isolated git worktrees
- Report progress and completion status
- Handle code generation, testing, and validation

### 3. Communication Agent (The Messenger)
**Location**: `packages/communicator`
**Responsibilities**:
- Routes messages between humans and agents
- Slack integration for team collaboration
- SMS/Twilio for urgent notifications
- Natural language processing for intent detection
- Maintains conversation context and threading

### 4. PMO System (Project Management Office)
**Location**: `pmo/`
**Structure**:
```
pmo/
├── specs/
│   ├── active/      # Current sprint specs
│   ├── backlog/     # Future work
│   └── completed/   # Done specs
├── templates/       # Spec templates
└── config.yaml      # PMO configuration
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Communication Layer                      │
│  ┌──────────┐        ┌──────────┐        ┌──────────┐      │
│  │  Slack   │        │   SMS    │        │   API    │      │
│  └────┬─────┘        └────┬─────┘        └────┬─────┘      │
│       └──────────┬────────┴────────┬──────────┘            │
│                  ▼                  ▼                        │
│         ┌──────────────────────────────────┐                │
│         │    Communication Agent           │                │
│         │    (Message Router & NLP)        │                │
│         └──────────────┬───────────────────┘                │
└────────────────────────┼────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Orchestration Layer                        │
│         ┌──────────────────────────────────┐                │
│         │      Orchestrator Agent          │                │
│         │   (Task Assignment & Monitoring) │                │
│         └─────┬────────────────────┬───────┘                │
│               ▼                    ▼                         │
│      ┌────────────────┐   ┌────────────────┐               │
│      │  Task Queue    │   │  PMO Parser    │               │
│      └────────────────┘   └────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Execution Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  │ Worker N │   │
│  │ (bezos)  │  │  (musk)  │  │ (gates)  │  │   ...    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       ▼              ▼              ▼              ▼        │
│  Git Worktree   Git Worktree   Git Worktree   Git Worktree │
└─────────────────────────────────────────────────────────────┘
```

## Communication Protocols

### 1. Agent-to-Agent Protocol
- **Transport**: Redis Pub/Sub or RabbitMQ
- **Format**: JSON-RPC 2.0
- **Topics**:
  - `agent.register` - Worker registration
  - `task.assign` - Task assignment
  - `task.status` - Progress updates
  - `task.complete` - Completion notification

### 2. Human-to-Agent Protocol
- **Slack Commands**:
  - `/prlt status` - Get system status
  - `/prlt assign @bezos "implement auth"` - Direct assignment
  - `/prlt report` - Get progress report
  
- **SMS Commands**:
  - `STATUS` - Get brief status
  - `URGENT: <message>` - Priority routing
  - `ASSIGN <agent> <task>` - Quick assignment

## Task Specification Format

```yaml
# pmo/specs/active/AUTH-001.yaml
spec:
  id: AUTH-001
  title: "Implement JWT Authentication"
  priority: high
  assigned_to: auto  # or specific agent
  requirements:
    - description: "Add JWT token generation"
    - description: "Implement refresh token logic"
    - description: "Add middleware for validation"
  acceptance_criteria:
    - "All tests pass"
    - "Documentation updated"
    - "Security review completed"
  dependencies:
    - DATABASE-001
  estimated_hours: 8
```

## Worker Agent Capabilities

```typescript
interface WorkerCapabilities {
  name: string;           // e.g., "bezos", "musk"
  skills: string[];       // ["frontend", "backend", "testing"]
  languages: string[];    // ["typescript", "python", "rust"]
  availability: 'idle' | 'busy' | 'offline';
  currentTask?: string;
  performance: {
    tasksCompleted: number;
    averageTime: number;
    successRate: number;
  };
}
```

## Message Flow Examples

### 1. Slack-Initiated Task
```
User → Slack: "Hey @proletariat, can you implement user authentication?"
Slack → Communicator: Parse intent and context
Communicator → Orchestrator: Create task request
Orchestrator → PMO: Generate spec AUTH-001
Orchestrator → Worker Pool: Find available agent with auth skills
Orchestrator → Bezos: Assign AUTH-001
Bezos → Git: Create worktree, implement solution
Bezos → Orchestrator: Report completion
Orchestrator → Communicator: Format success message
Communicator → Slack: "✅ Bezos completed authentication in 2.5 hours"
```

### 2. PMO-Driven Batch Processing
```
Orchestrator → PMO: Scan for new specs
PMO → Orchestrator: Return 5 new specs
Orchestrator → Task Queue: Prioritize and queue specs
Orchestrator → Workers: Broadcast available tasks
Workers → Orchestrator: Claim tasks based on skills
Workers → Git: Parallel implementation
Workers → Orchestrator: Stream progress updates
Orchestrator → Communicator: Aggregate status
Communicator → Slack/SMS: Send periodic updates
```

## Deployment Architecture

### Local Development
```bash
# Start all services
npm run dev:orchestrator
npm run dev:communicator
npm run dev:workers

# Or use docker-compose
docker-compose up
```

### Production Deployment
- **Orchestrator**: Kubernetes StatefulSet (1 replica)
- **Workers**: Kubernetes Deployment (auto-scaling 1-10 replicas)
- **Communicator**: Kubernetes Deployment (2 replicas)
- **Message Queue**: Redis Cluster or RabbitMQ
- **Database**: PostgreSQL for state persistence
- **Monitoring**: Prometheus + Grafana

## Security Considerations

1. **Authentication**:
   - Slack: OAuth 2.0 with workspace verification
   - SMS: Phone number whitelist
   - API: JWT tokens with role-based access

2. **Agent Security**:
   - Sandboxed execution environments
   - Resource limits per worker
   - Code review before merge

3. **Data Protection**:
   - Encrypted communication channels
   - Secrets management via Vault
   - Audit logging for all operations

## Next Steps

1. Implement core orchestrator logic
2. Create worker agent framework
3. Build Slack integration
4. Add SMS/Twilio support
5. Design PMO spec templates
6. Create monitoring dashboard
7. Write deployment manifests
8. Add comprehensive testing