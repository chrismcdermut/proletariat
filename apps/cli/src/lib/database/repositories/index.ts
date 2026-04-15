/**
 * Repository Layer — Index
 *
 * Centralized data access layer for all database operations.
 * All DB access should go through these repositories.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 *
 * Usage:
 *   import { createRepositories } from './repositories/index.js'
 *   const repos = createRepositories(drizzleDb)
 *   const agent = repos.agents.findByName('my-agent')
 */

import type { DrizzleDB } from '../drizzle.js'
import type { RepositoryContext } from './types.js'
import { AgentRepository } from './agent-repository.js'
import { SessionRepository } from './session-repository.js'
import { WorkflowRepository } from './workflow-repository.js'
import { ProjectRepository } from './project-repository.js'
import { PRRepository } from './pr-repository.js'
import { TicketRepository } from './ticket-repository.js'

// Re-export all types
export * from './types.js'

// Re-export repository classes and interfaces
export {
  AgentRepository,
  type IAgentRepository,
} from './agent-repository.js'
export {
  SessionRepository,
  type ISessionRepository,
} from './session-repository.js'
export {
  WorkflowRepository,
  type IWorkflowRepository,
} from './workflow-repository.js'
export {
  ProjectRepository,
  type IProjectRepository,
} from './project-repository.js'
export {
  PRRepository,
  type IPRRepository,
} from './pr-repository.js'
export {
  TicketRepository,
  type ITicketRepository,
  type TicketTemplateRecord,
  type CreateTicketTemplateInput,
  type TicketTemplateFilter,
} from './ticket-repository.js'

// =============================================================================
// Repository Container
// =============================================================================

/**
 * Container holding all repository instances.
 * Created once per database connection and passed to consumers.
 */
export interface Repositories {
  agents: AgentRepository
  sessions: SessionRepository
  workflows: WorkflowRepository
  projects: ProjectRepository
  prs: PRRepository
  tickets: TicketRepository
}

/**
 * Create all repositories from a Drizzle database connection.
 *
 * @param drizzle - The Drizzle ORM database connection
 * @returns All repository instances sharing the same connection
 *
 * @example
 * ```typescript
 * import { withDrizzle } from '../database/workspace.js'
 * import { createRepositories } from '../database/repositories/index.js'
 *
 * withDrizzle(workspacePath, (ddb) => {
 *   const repos = createRepositories(ddb)
 *   const agent = repos.agents.findByName('my-agent')
 *   const executions = repos.sessions.listActive()
 * })
 * ```
 */
export function createRepositories(drizzle: DrizzleDB): Repositories {
  const ctx: RepositoryContext = { drizzle }

  return {
    agents: new AgentRepository(ctx),
    sessions: new SessionRepository(ctx),
    workflows: new WorkflowRepository(ctx),
    projects: new ProjectRepository(ctx),
    prs: new PRRepository(ctx),
    tickets: new TicketRepository(ctx),
  }
}
