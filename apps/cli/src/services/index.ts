/**
 * Service Layer
 *
 * Clean interface between lib/ (data/infra) and consumers (CLI, web, LLM).
 *
 * Usage from any consumer (no oclif required):
 *
 *   import { WorkService, TicketService } from './services/index.js'
 *
 *   const workService = new WorkService(db, storage, resolveProvider)
 *   const result = await workService.shipWork({ ticketId: 'TKT-123' })
 */

export { WorkService } from './work-service.js'
export type { WorkServiceStorage, ProviderResolver, ServiceLogger } from './work-service.js'

export { TicketService } from './ticket-service.js'
export type { TicketServiceStorage } from './ticket-service.js'

export { SessionService } from './session-service.js'

export { ReconcileService } from './reconcile-service.js'

export { PRService } from './pr-service.js'
export type { PRServiceStorage } from './pr-service.js'

export { ServiceError } from './types.js'
export type {
  ServiceErrorCode,
  StartWorkOptions,
  StartWorkResult,
  ShipWorkOptions,
  ShipWorkResult,
  ShipAllOptions,
  ShipAllResult,
  ListTicketsOptions,
  ListTicketsResult,
  GetTicketResult,
  ListSessionsOptions,
  ListSessionsResult,
  RunReconcileOptions,
  WatchReconcileOptions,
  CreatePROptions,
  CreatePRServiceResult,
  MergePROptions,
  MergePRServiceResult,
  CheckCIOptions,
  CheckCIResult,
  LinkedTicketResult,
} from './types.js'
