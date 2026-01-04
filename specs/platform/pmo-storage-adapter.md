# PMO Storage: PMO Tool Adapter

## Overview

Adapter-based storage that integrates with existing PMO/project management tools like Jira, Linear, and Notion. The external tool becomes the source of truth - this adapter translates between the PMO interface and the tool's API.

## When to Use

| Setup | Recommendation |
|-------|----------------|
| Solo * | ⚠️ Overkill unless already using the tool |
| Team * | ✅ Great if team already pays for Jira/Linear |
| Enterprise * | ✅ Often mandated by organization |

## Why Adapters?

- **Use existing tools** - No migration, no new UI to learn
- **Single source of truth** - Tool is canonical, PMO syncs
- **Team visibility** - Non-technical stakeholders use familiar UI
- **Existing workflows** - Keep Jira automations, Linear cycles, etc.

## Supported Tools

| Tool | Status | API |
|------|--------|-----|
| Jira | Planned | REST API v3 |
| Linear | Planned | GraphQL API |
| Notion | Planned | REST API |
| GitHub Projects | Future | GraphQL API |
| Trello | Future | REST API |
| Asana | Future | REST API |

## Configuration

### config.yaml

```yaml
# PMO Configuration
version: 1

storage:
  type: adapter
  adapter: jira           # jira, linear, notion

  # Jira-specific
  jira:
    host: https://yourcompany.atlassian.net
    project: PMO
    auth: env:JIRA_API_TOKEN
    email: env:JIRA_EMAIL

  # Linear-specific
  linear:
    team: ENG
    auth: env:LINEAR_API_KEY

  # Notion-specific
  notion:
    database_id: abc123...
    auth: env:NOTION_API_KEY

# Field mapping
mapping:
  columns:
    - name: Backlog
      external: To Do          # Jira status
    - name: In Progress
      external: In Progress
    - name: Review
      external: In Review
    - name: Done
      external: Done

  fields:
    priority:
      external: priority       # Jira/Linear field name
      values:
        URGENT: Highest
        IMPORTANT: High
        LOW: Low
    category:
      external: labels         # or custom field
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI       │────▶│   Adapter   │────▶│  Jira/etc   │
│  Commands   │     │  Interface  │     │    API      │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              ┌─────┴────┐ ┌──────┴─────┐
              │  Jira    │ │   Linear   │ ...
              │ Adapter  │ │   Adapter  │
              └──────────┘ └────────────┘
```

## Adapter Interface

Each adapter implements the standard PMOStorage interface:

```typescript
interface PMOAdapter extends PMOStorage {
  // Standard operations from PMOStorage
  init(config: BoardConfig): Promise<Board>
  getBoard(): Promise<Board>
  getBoardMarkdown(): Promise<string>
  createTicket(ticket: Partial<Ticket>): Promise<Ticket>
  updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket>
  moveTicket(id: string, column: string, position?: number): Promise<Ticket>
  deleteTicket(id: string): Promise<void>
  listTickets(filter?: TicketFilter): Promise<Ticket[]>
  getTicket(id: string): Promise<Ticket | null>

  // Sync is real for adapters
  pull(): Promise<SyncResult>
  push(): Promise<SyncResult>
  status(): Promise<SyncStatus>

  // Adapter-specific
  mapToExternal(ticket: Ticket): ExternalTicket
  mapFromExternal(external: ExternalTicket): Ticket
}
```

## Jira Adapter

### Configuration

```yaml
storage:
  type: adapter
  adapter: jira
  jira:
    host: https://yourcompany.atlassian.net
    project: PMO
    auth: env:JIRA_API_TOKEN
    email: env:JIRA_EMAIL
    board_id: 123             # optional, for board-specific queries
```

### Field Mapping

```typescript
// PMO Ticket → Jira Issue
function mapToJira(ticket: Ticket): JiraIssue {
  return {
    fields: {
      project: { key: config.jira.project },
      summary: ticket.title,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: ticket.description || '' }] }]
      },
      issuetype: { name: 'Task' },
      priority: { name: mapPriority(ticket.priority) },
      labels: ticket.category ? [ticket.category] : [],
      // Custom fields mapped from config
    }
  }
}

// Jira Issue → PMO Ticket
function mapFromJira(issue: JiraIssue): Ticket {
  return {
    id: issue.key,                          // e.g., "PMO-123"
    title: issue.fields.summary,
    column: mapStatus(issue.fields.status.name),
    position: 0,                            // Jira doesn't have position
    priority: mapPriorityReverse(issue.fields.priority?.name),
    category: issue.fields.labels?.[0],
    description: extractText(issue.fields.description),
    subtasks: issue.fields.subtasks?.map(s => ({
      id: s.key,
      title: s.fields.summary,
      done: s.fields.status.name === 'Done'
    })) || [],
    metadata: {},
    createdAt: new Date(issue.fields.created),
    updatedAt: new Date(issue.fields.updated)
  }
}
```

### Implementation

```typescript
class JiraAdapter implements PMOAdapter {
  private client: JiraClient

  constructor(config: JiraConfig) {
    this.client = new JiraClient({
      host: config.host,
      authentication: {
        basic: {
          email: config.email,
          apiToken: config.auth
        }
      }
    })
  }

  async getBoard(): Promise<Board> {
    // Get all issues in project
    const issues = await this.client.searchJira(
      `project = ${this.config.project} ORDER BY created DESC`,
      { maxResults: 1000 }
    )

    // Group by status → columns
    const columns = this.config.mapping.columns.map(col => ({
      id: slugify(col.name),
      name: col.name,
      position: 0,
      tickets: issues.issues
        .filter(i => mapStatus(i.fields.status.name) === col.name)
        .map(i => this.mapFromJira(i))
    }))

    return {
      id: this.config.project,
      name: `${this.config.project} Board`,
      columns,
      updatedAt: new Date()
    }
  }

  async createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
    const jiraIssue = this.mapToJira(ticket)
    const created = await this.client.addNewIssue(jiraIssue)
    return this.getTicket(created.key)
  }

  async updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
    const updates: any = {}

    if (changes.title) updates.summary = changes.title
    if (changes.description) updates.description = this.formatDescription(changes.description)
    if (changes.priority) updates.priority = { name: mapPriority(changes.priority) }
    if (changes.category) updates.labels = [changes.category]

    await this.client.updateIssue(id, { fields: updates })
    return this.getTicket(id)
  }

  async moveTicket(id: string, column: string): Promise<Ticket> {
    // Find transition to target status
    const transitions = await this.client.listTransitions(id)
    const targetStatus = this.config.mapping.columns.find(c => c.name === column)?.external
    const transition = transitions.transitions.find(t => t.to.name === targetStatus)

    if (!transition) {
      throw new PMOError('INVALID', `Cannot transition to ${column}`)
    }

    await this.client.transitionIssue(id, { transition: { id: transition.id } })
    return this.getTicket(id)
  }

  async deleteTicket(id: string): Promise<void> {
    await this.client.deleteIssue(id)
  }

  async pull(): Promise<SyncResult> {
    // Jira is source of truth, pull is a no-op
    // (we always fetch fresh from API)
    return { success: true, changes: 0 }
  }

  async push(): Promise<SyncResult> {
    // All writes go directly to Jira API
    return { success: true, changes: 0 }
  }
}
```

## Linear Adapter

### Configuration

```yaml
storage:
  type: adapter
  adapter: linear
  linear:
    team: ENG
    auth: env:LINEAR_API_KEY
```

### Implementation

```typescript
class LinearAdapter implements PMOAdapter {
  private client: LinearClient

  constructor(config: LinearConfig) {
    this.client = new LinearClient({ apiKey: config.auth })
  }

  async getBoard(): Promise<Board> {
    const team = await this.client.team(this.config.team)
    const issues = await team.issues()
    const states = await team.states()

    // Map Linear states to columns
    const columns = this.config.mapping.columns.map(col => {
      const state = states.nodes.find(s => s.name === col.external)
      return {
        id: state?.id || slugify(col.name),
        name: col.name,
        position: 0,
        tickets: issues.nodes
          .filter(i => i.state.name === col.external)
          .map(i => this.mapFromLinear(i))
      }
    })

    return {
      id: team.id,
      name: `${team.name} Board`,
      columns,
      updatedAt: new Date()
    }
  }

  async createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
    const team = await this.client.team(this.config.team)
    const state = await this.findState(ticket.column || 'Backlog')

    const issue = await this.client.createIssue({
      teamId: team.id,
      title: ticket.title,
      description: ticket.description,
      stateId: state.id,
      priority: this.mapPriority(ticket.priority),
      labelIds: ticket.category ? [await this.findOrCreateLabel(ticket.category)] : []
    })

    return this.mapFromLinear(await issue.issue)
  }

  async moveTicket(id: string, column: string): Promise<Ticket> {
    const state = await this.findState(column)
    await this.client.updateIssue(id, { stateId: state.id })
    return this.getTicket(id)
  }
}
```

## Notion Adapter

### Configuration

```yaml
storage:
  type: adapter
  adapter: notion
  notion:
    database_id: abc123def456...
    auth: env:NOTION_API_KEY
```

### Implementation

```typescript
class NotionAdapter implements PMOAdapter {
  private client: Client

  constructor(config: NotionConfig) {
    this.client = new Client({ auth: config.auth })
  }

  async getBoard(): Promise<Board> {
    // Query Notion database
    const response = await this.client.databases.query({
      database_id: this.config.database_id,
      sorts: [{ property: 'Created', direction: 'descending' }]
    })

    // Group by Status property → columns
    const columns = this.config.mapping.columns.map(col => ({
      id: slugify(col.name),
      name: col.name,
      position: 0,
      tickets: response.results
        .filter(p => this.getStatus(p) === col.external)
        .map(p => this.mapFromNotion(p))
    }))

    return {
      id: this.config.database_id,
      name: 'Notion Board',
      columns,
      updatedAt: new Date()
    }
  }

  async createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
    const page = await this.client.pages.create({
      parent: { database_id: this.config.database_id },
      properties: {
        Name: { title: [{ text: { content: ticket.title } }] },
        Status: { select: { name: this.mapColumnToStatus(ticket.column) } },
        Priority: { select: { name: ticket.priority || 'LOW' } },
        Category: { select: { name: ticket.category } }
      },
      children: ticket.description ? [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: ticket.description } }]
          }
        }
      ] : []
    })

    return this.mapFromNotion(page)
  }

  async moveTicket(id: string, column: string): Promise<Ticket> {
    await this.client.pages.update({
      page_id: id,
      properties: {
        Status: { select: { name: this.mapColumnToStatus(column) } }
      }
    })
    return this.getTicket(id)
  }

  private mapFromNotion(page: any): Ticket {
    const props = page.properties
    return {
      id: page.id,
      title: props.Name?.title?.[0]?.plain_text || 'Untitled',
      column: this.mapStatusToColumn(props.Status?.select?.name),
      position: 0,
      priority: props.Priority?.select?.name,
      category: props.Category?.select?.name,
      description: '', // Would need to fetch page content
      subtasks: [],    // Would need to parse todo blocks
      metadata: {},
      createdAt: new Date(page.created_time),
      updatedAt: new Date(page.last_edited_time)
    }
  }
}
```

## Sync Behavior

Unlike Git or SQLite, adapters have real sync considerations:

### Local Cache (Optional)

For offline support or performance:

```typescript
interface CachedAdapter extends PMOAdapter {
  // Local cache of board state
  private cache: Board | null
  private cacheTime: Date | null
  private cacheTTL: number = 60000  // 1 minute

  async getBoard(): Promise<Board> {
    if (this.cache && Date.now() - this.cacheTime.getTime() < this.cacheTTL) {
      return this.cache
    }
    this.cache = await this.fetchBoard()
    this.cacheTime = new Date()
    return this.cache
  }

  async pull(): Promise<SyncResult> {
    // Force refresh cache
    const oldCache = this.cache
    this.cache = await this.fetchBoard()
    this.cacheTime = new Date()

    const changes = this.diffBoards(oldCache, this.cache)
    return { success: true, changes: changes.length }
  }
}
```

### Webhooks (Advanced)

For real-time sync:

```typescript
// Webhook handler for Jira/Linear/Notion events
app.post('/webhook/:adapter', async (req, res) => {
  const { adapter } = req.params
  const event = req.body

  switch (adapter) {
    case 'jira':
      if (event.webhookEvent === 'jira:issue_updated') {
        await notifyAgents('ticket_updated', event.issue.key)
      }
      break
    case 'linear':
      if (event.type === 'Issue') {
        await notifyAgents('ticket_updated', event.data.id)
      }
      break
  }

  res.sendStatus(200)
})
```

## CLI Examples

```bash
# Initialize with Jira
export JIRA_API_TOKEN="your-token"
export JIRA_EMAIL="you@company.com"
prlt board init --storage adapter --adapter jira --host https://company.atlassian.net --project PMO

# Initialize with Linear
export LINEAR_API_KEY="your-key"
prlt board init --storage adapter --adapter linear --team ENG

# Initialize with Notion
export NOTION_API_KEY="your-key"
prlt board init --storage adapter --adapter notion --database abc123...

# View board (fetches from API)
prlt board view

# Create ticket (creates in external tool)
prlt ticket create --title "New feature" --column "Backlog"

# Ticket IDs are from external tool
prlt ticket view PMO-123      # Jira
prlt ticket view ENG-456      # Linear
prlt ticket view abc123...    # Notion page ID
```

## Error Handling

### Rate Limits

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (e.status === 429) {  // Rate limited
        const delay = e.headers?.['retry-after'] || Math.pow(2, i) * 1000
        await sleep(delay)
        continue
      }
      throw e
    }
  }
  throw new PMOError('SYNC_FAILED', 'Rate limit exceeded')
}
```

### Auth Failures

```typescript
async function getBoard(): Promise<Board> {
  try {
    return await this.fetchBoard()
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw new PMOError('INVALID', 'Authentication failed - check API token')
    }
    throw e
  }
}
```

## Migration

See [pmo-migrate.md](./pmo-migrate.md) for migrating to/from adapter storage.

### Import Existing Data

```bash
# Export from Jira to markdown
prlt board export --format markdown > board.md

# Then import to different storage
prlt board init --storage sqlite
prlt board import board.md
```
