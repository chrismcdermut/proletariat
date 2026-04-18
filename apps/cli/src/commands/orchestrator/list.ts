import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { MachineDB, type OrchestratorThreadRecord } from '../../lib/machine-db.js'

export default class OrchestratorList extends PromptCommand {
  static description = 'List registered orchestrator threads'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorList)
    const jsonMode = shouldOutputJson(flags)

    let threads: OrchestratorThreadRecord[]
    try {
      const machineDb = new MachineDB()
      try {
        threads = machineDb.listThreads()
      } finally {
        machineDb.close()
      }
    } catch {
      if (jsonMode) {
        outputSuccessAsJson({ threads: [] }, createMetadata('orchestrator list', flags as Record<string, unknown>))
        return
      }
      this.log(styles.muted('No orchestrator threads registered.'))
      return
    }

    if (jsonMode) {
      outputSuccessAsJson({
        threads: threads.map(threadToJson),
      }, createMetadata('orchestrator list', flags as Record<string, unknown>))
      return
    }

    this.log('')
    if (threads.length === 0) {
      this.log(styles.muted('No orchestrator threads registered.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
      this.log('')
      return
    }

    this.log(styles.header(`Registered orchestrator threads (${threads.length})`))
    this.log('')

    for (const thread of threads) {
      const statusIcon = thread.status === 'active' ? styles.success('active') : styles.muted('inactive')
      const routeLabel = thread.routes ? thread.routes.join(', ') : '(catch-all)'
      this.log(`   ${thread.name} — ${statusIcon}`)
      this.log(styles.muted(`     Address: ${thread.address}`))
      this.log(styles.muted(`     Routes:  ${routeLabel}`))
      this.log(styles.muted(`     Since:   ${thread.registeredAt.toISOString()}`))
      this.log(styles.muted(`     Seen:    ${thread.lastSeen.toISOString()}`))
      this.log('')
    }
  }
}

function threadToJson(t: OrchestratorThreadRecord): Record<string, unknown> {
  return {
    name: t.name,
    address: t.address,
    routes: t.routes,
    status: t.status,
    registeredAt: t.registeredAt.toISOString(),
    lastSeen: t.lastSeen.toISOString(),
  }
}
