import { Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { MachineDB, type OrchestratorThreadRecord } from '../../lib/machine-db.js'

export default class OrchestratorRoutes extends PromptCommand {
  static description = 'Show which events route to which orchestrator threads'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --event on_pr_opened',
  ]

  static flags = {
    ...machineOutputFlags,
    event: Flags.string({
      char: 'e',
      description: 'Check which orchestrator handles a specific event',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorRoutes)
    const jsonMode = shouldOutputJson(flags)

    let threads: OrchestratorThreadRecord[]
    const machineDb = new MachineDB()
    try {
      threads = machineDb.listThreads({ status: 'active' })

      // If --event is specified, find the specific handler
      if (flags.event) {
        const handler = machineDb.findThreadForEvent(flags.event)
        if (jsonMode) {
          outputSuccessAsJson({
            event: flags.event,
            handler: handler ? {
              name: handler.name,
              address: handler.address,
              routes: handler.routes,
              isCatchAll: handler.routes === null,
            } : null,
          }, createMetadata('orchestrator routes', flags as Record<string, unknown>))
          return
        }

        this.log('')
        if (handler) {
          const routeType = handler.routes === null ? '(catch-all)' : '(explicit route)'
          this.log(`   ${flags.event} → ${handler.name} ${styles.muted(routeType)}`)
          this.log(styles.muted(`   Address: ${handler.address}`))
        } else {
          this.log(styles.muted(`   No orchestrator handles event "${flags.event}"`))
        }
        this.log('')
        return
      }
    } finally {
      machineDb.close()
    }

    if (jsonMode) {
      const routeMap = buildRouteMap(threads)
      outputSuccessAsJson({
        threads: threads.map(t => ({
          name: t.name,
          routes: t.routes,
          isCatchAll: t.routes === null,
          address: t.address,
        })),
        routeMap,
      }, createMetadata('orchestrator routes', flags as Record<string, unknown>))
      return
    }

    this.log('')
    if (threads.length === 0) {
      this.log(styles.muted('No active orchestrator threads.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
      this.log('')
      return
    }

    this.log(styles.header('Event routing table'))
    this.log('')

    // Show explicit routes first
    const explicit = threads.filter(t => t.routes !== null)
    const catchAlls = threads.filter(t => t.routes === null)

    for (const thread of explicit) {
      for (const route of thread.routes!) {
        this.log(`   ${route} → ${thread.name}`)
      }
    }

    if (catchAlls.length > 0) {
      if (explicit.length > 0) this.log('')
      for (const thread of catchAlls) {
        this.log(`   ${styles.muted('(everything else)')} → ${thread.name}`)
      }
    }

    this.log('')
  }
}

function buildRouteMap(threads: OrchestratorThreadRecord[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const t of threads) {
    if (t.routes) {
      for (const route of t.routes) {
        map[route] = t.name
      }
    }
  }
  // Mark catch-all
  const catchAll = threads.find(t => t.routes === null)
  if (catchAll) {
    map['*'] = catchAll.name
  }
  return map
}
