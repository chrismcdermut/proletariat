/**
 * prlt gateway status — Show registered messaging channels and routes.
 *
 * Reports one line per channel with its type, active flag, last
 * activity timestamp, and the number of user→agent routes it owns.
 */

import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { MachineDB, type MessagingChannelRecord } from '../../lib/machine-db.js'

interface ChannelStatus {
  name: string
  type: string
  active: boolean
  lastMessageAt: string | null
  routeCount: number
}

export default class GatewayStatus extends PromptCommand {
  static description = 'Show registered messaging channels and their activity'

  static examples = ['<%= config.bin %> gateway status']

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(GatewayStatus)
    const jsonMode = shouldOutputJson(flags)

    const db = new MachineDB()
    let statuses: ChannelStatus[] = []
    try {
      const channels = db.listMessagingChannels({ onlyActive: false })
      statuses = channels.map(ch => buildStatus(db, ch))
    } finally {
      db.close()
    }

    if (jsonMode) {
      outputSuccessAsJson({ channels: statuses }, createMetadata('gateway status', flags))
      return
    }

    if (statuses.length === 0) {
      this.log(styles.muted('No messaging channels registered.'))
      this.log(styles.muted('Connect one with: prlt gateway connect telegram --token ... --allow ...'))
      return
    }

    this.log(styles.header('Messaging Gateway Channels'))
    this.log('')
    for (const s of statuses) {
      const active = s.active ? styles.success('active') : styles.muted('inactive')
      const last = s.lastMessageAt ? formatRelative(new Date(s.lastMessageAt)) : 'never'
      this.log(`  ${styles.emphasis(s.name)} [${s.type}] — ${active}`)
      this.log(`    last activity: ${last}`)
      this.log(`    routes: ${s.routeCount}`)
      this.log('')
    }
  }
}

function buildStatus(db: MachineDB, ch: MessagingChannelRecord): ChannelStatus {
  return {
    name: ch.name,
    type: ch.type,
    active: ch.active,
    lastMessageAt: ch.lastMessageAt ? ch.lastMessageAt.toISOString() : null,
    routeCount: db.countMessagingRoutesForChannel(ch.name),
  }
}

function formatRelative(d: Date): string {
  const deltaMs = Date.now() - d.getTime()
  if (deltaMs < 0) return d.toISOString()
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
