# ⚒️ PROLETARIAT ORCHESTRATION SYSTEM

> **Distributed Task Orchestration with Autonomous Worker Agents**  
> *From simple git worktrees to a full autonomous development workforce!*

## 🚀 Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/proletariat-dev/proletariat.git
cd proletariat

# 2. Install dependencies
npm install
cd packages/orchestrator && npm install && cd ../..
cd packages/communicator && npm install && cd ../..
cd packages/worker && npm install && cd ../..

# 3. Configure environment
cp .env.example .env
# Edit .env with your Slack/Twilio credentials

# 4. Start with Docker Compose
docker-compose up -d

# 5. Or start individually for development
npm run dev:orchestrator    # Terminal 1
npm run dev:communicator   # Terminal 2
npm run dev:worker -- bezos # Terminal 3
npm run dev:worker -- musk  # Terminal 4
```

## 📋 PMO System Usage

### Creating Specs

Create task specifications in `pmo/specs/active/`:

```yaml
# pmo/specs/active/AUTH-001.yaml
spec:
  id: AUTH-001
  title: "Implement JWT Authentication"
  priority: high
  requirements:
    - description: "Add JWT token generation"
      skills: ["backend", "security"]
      estimatedHours: 2
    - description: "Implement refresh token logic"
      skills: ["backend", "security"]
      estimatedHours: 2
  acceptanceCriteria:
    - "All tests pass"
    - "Documentation updated"
    - "Security review completed"
```

The orchestrator automatically:
1. Detects new specs
2. Breaks them into tasks
3. Assigns to qualified workers
4. Monitors progress
5. Moves completed specs to `pmo/specs/completed/`

## 💬 Slack Integration

### Setup
1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode
3. Add Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `commands`
   - `im:history`
   - `im:read`
   - `im:write`
4. Install app to workspace
5. Copy tokens to `.env`

### Commands
```
@proletariat status              # Get system status
@proletariat assign @bezos "implement auth"  # Assign task
@proletariat report              # Get detailed report
/prlt status                     # Slash command version
/prlt-assign bezos "fix bug"    # Direct assignment
```

## 📱 SMS Integration (Twilio)

### Setup
1. Get Twilio account at https://www.twilio.com
2. Get phone number
3. Configure webhook URL: `https://your-domain.com/webhooks/sms`
4. Add credentials to `.env`
5. Whitelist phone numbers in `SMS_WHITELIST`

### SMS Commands
```
STATUS           # Get status
ASSIGN bezos: implement feature  # Assign task
REPORT          # Get report
HELP            # Show commands
```

## 🤖 Worker Agents

### Starting Workers

```bash
# Start individual workers
WORKER_NAME=bezos WORKER_SKILLS=backend,infrastructure npm run worker
WORKER_NAME=musk WORKER_SKILLS=frontend,ai npm run worker
WORKER_NAME=gates WORKER_SKILLS=testing,documentation npm run worker

# Or use Docker Compose to start all
docker-compose up worker-bezos worker-musk worker-gates
```

### Worker Configuration

Each worker can have:
- **Name**: Agent identifier (bezos, musk, etc.)
- **Theme**: billionaires, cars, or companies
- **Skills**: backend, frontend, testing, etc.
- **Languages**: javascript, typescript, python, etc.

### Worker Lifecycle

1. **Registration**: Worker connects to orchestrator
2. **Idle**: Polls for available tasks
3. **Task Claim**: Claims matching task based on skills
4. **Execution**: Creates branch, implements solution
5. **Validation**: Runs tests, checks criteria
6. **Completion**: Commits code, reports success
7. **Return to Idle**: Ready for next task

## 🎯 Task Flow Example

```mermaid
graph LR
    A[User creates PMO spec] --> B[Orchestrator detects]
    B --> C[Parse & queue tasks]
    C --> D[Workers poll for tasks]
    D --> E[Worker claims task]
    E --> F[Execute in git worktree]
    F --> G[Validate & test]
    G --> H[Commit & complete]
    H --> I[Notify via Slack/SMS]
```

## 📊 Monitoring

### Grafana Dashboard
Access at `http://localhost:3002` (password: `revolution`)

Monitors:
- Active workers
- Task queue depth
- Task completion rate
- Worker performance
- System health

### API Endpoints

**Orchestrator (port 3000):**
- `GET /api/status` - System status
- `GET /api/workers` - List workers
- `GET /api/tasks` - List tasks
- `POST /api/tasks` - Create task

**Communicator (port 3001):**
- `GET /api/status` - Channel status
- `POST /api/send` - Send message

## 🏗️ Architecture

### Components

1. **Orchestrator** (`packages/orchestrator`)
   - PMO watcher
   - Task queue (Redis/Bull)
   - Worker registry
   - Assignment logic

2. **Communicator** (`packages/communicator`)
   - Slack bot
   - SMS handler
   - Intent parser
   - Message router

3. **Workers** (`packages/worker`)
   - Task executor
   - Git manager
   - Code generator
   - Test runner

### Data Flow

```
PMO Specs → Orchestrator → Task Queue
                ↓
         Worker Registry
                ↓
          Worker Agents
                ↓
         Git Worktrees
                ↓
        Code Generation
                ↓
         Validation
                ↓
     Completion Report
                ↓
    Slack/SMS Notification
```

## 🚢 Production Deployment

### Kubernetes

```bash
# Create namespace
kubectl create namespace proletariat

# Deploy services
kubectl apply -f k8s/

# Scale workers
kubectl scale deployment worker --replicas=10
```

### Environment Variables

Required for production:
- `NODE_ENV=production`
- `REDIS_URL` - Redis connection
- `DATABASE_URL` - PostgreSQL connection
- `SLACK_*` - Slack credentials
- `TWILIO_*` - Twilio credentials

## 🔧 Advanced Configuration

### Custom Worker Skills

```javascript
// packages/worker/src/skills/custom-skill.ts
export class CustomSkill {
  canHandle(task) {
    return task.requiredSkills.includes('custom');
  }
  
  async execute(task) {
    // Implementation
  }
}
```

### Task Prioritization

Edit `packages/orchestrator/src/task-queue.ts`:
```javascript
getPriorityValue(priority) {
  // Customize priority scoring
}
```

### Custom Communication Channels

Implement `CommunicationChannel` interface:
```javascript
export class DiscordChannel extends CommunicationChannel {
  async send(to, message) {
    // Discord implementation
  }
}
```

## 🐛 Troubleshooting

### Workers not claiming tasks
- Check worker skills match task requirements
- Verify orchestrator connection
- Check Redis connectivity

### Slack not responding
- Verify bot tokens and permissions
- Check Socket Mode is enabled
- Ensure app is installed to workspace

### SMS not working
- Verify Twilio credentials
- Check webhook URL configuration
- Ensure numbers are whitelisted

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Implement with tests
4. Submit pull request

## 📜 License

MIT License - Workers of the codebase, unite!

---

**🚩 THE REVOLUTION WILL BE ORCHESTRATED! ✊**