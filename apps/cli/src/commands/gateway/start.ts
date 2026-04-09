/**
 * prlt gateway start — Start the messaging gateway daemon.
 *
 * Loads every active channel from machine.db, wires it up to the
 * MessagingGateway router, and blocks until SIGINT/SIGTERM. Each inbound
 * message is forwarded to its bound agent via `prlt session poke`.
 *
 * MVP note: this runs in the foreground. `--background` is documented on
 * the ticket but intentionally deferred — it will land alongside the
 * generic daemon lifecycle work in a follow-up ticket.
 */

import { Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { MachineDB } from '../../lib/machine-db.js'
import { MessagingGateway } from '../../lib/gateway/router.js'
import { ShellSessionPoker } from '../../lib/gateway/session-poker.js'
import { buildChannelFromRecord } from '../../lib/gateway/channel-factory.js'
import type { Message } from '../../lib/gateway/types.js'

export default class GatewayStart extends PromptCommand {
  static description = 'Start the messaging gateway daemon (foreground)'

  static examples = [
    '<%= config.bin %> gateway start',
    '<%= config.bin %> gateway start --default-agent altman',
  ]

  static flags = {
    ...machineOutputFlags,
    'default-agent': Flags.string({
      description: 'Agent session id to bind newly-seen users to (required unless a static resolver is configured)',
    }),
    'wait-timeout': Flags.integer({
      description: 'Max seconds to wait for an agent response before giving up',
      default: 90,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(GatewayStart)
    const jsonMode = shouldOutputJson(flags)

    const db = new MachineDB()

    // Load active channels at startup. A future revision can hot-reload
    // this by watching the table for changes, but the MVP only reads at
    // start time.
    const records = db.listMessagingChannels({ onlyActive: true })
    if (records.length === 0) {
      db.close()
      if (jsonMode) {
        outputErrorAsJson(
          'NO_CHANNELS',
          'No active messaging channels registered. Connect one first with `prlt gateway connect`.',
          createMetadata('gateway start', flags),
        )
        return
      }
      this.log(styles.error('No active messaging channels registered.'))
      this.log(styles.muted('Connect one with: prlt gateway connect telegram --token ... --allow ...'))
      return
    }

    const gateway = new MessagingGateway({
      db,
      sessionPoker: new ShellSessionPoker(),
      waitTimeoutSec: flags['wait-timeout'],
      resolveAgentForNewUser: (_msg: Message) => flags['default-agent'] ?? null,
      logger: {
        info: msg => this.log(styles.muted(msg)),
        error: (msg, err) => {
          const errMsg = err instanceof Error ? err.message : err !== undefined ? String(err) : ''
          this.log(styles.error(errMsg ? `${msg}: ${errMsg}` : msg))
        },
      },
    })

    for (const record of records) {
      try {
        const channel = buildChannelFromRecord(record)
        gateway.registerChannel(channel)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.log(styles.error(`Failed to build channel "${record.name}": ${errMsg}`))
      }
    }

    if (gateway.listChannelNames().length === 0) {
      db.close()
      if (jsonMode) {
        outputErrorAsJson(
          'NO_VALID_CHANNELS',
          'No valid messaging channels could be built from storage.',
          createMetadata('gateway start', flags),
        )
        return
      }
      this.log(styles.error('No valid messaging channels could be built from storage.'))
      return
    }

    await gateway.start()

    if (jsonMode) {
      outputSuccessAsJson(
        {
          started: true,
          channels: gateway.listChannelNames(),
          defaultAgent: flags['default-agent'] ?? null,
        },
        createMetadata('gateway start', flags),
      )
    } else {
      this.log(styles.success('Messaging gateway started'))
      this.log(styles.muted(`  channels: ${gateway.listChannelNames().join(', ')}`))
      if (flags['default-agent']) {
        this.log(styles.muted(`  default agent: ${flags['default-agent']}`))
      } else {
        this.log(styles.warning('  no --default-agent: new users will be rejected'))
      }
      this.log(styles.muted('  press Ctrl-C to stop'))
    }

    // Block until we're asked to shut down. We install handlers for both
    // SIGINT and SIGTERM so `docker stop` and Ctrl-C both unwind cleanly.
    await waitForShutdownSignal()

    this.log(styles.muted('Shutting down gateway...'))
    try {
      await gateway.stop()
    } finally {
      db.close()
    }
  }
}

/**
 * Resolve when we receive SIGINT or SIGTERM. Exported-less so tests don't
 * have to shim it — the test suite exercises `MessagingGateway` directly.
 */
function waitForShutdownSignal(): Promise<void> {
  return new Promise(resolve => {
    const onSignal = () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      resolve()
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  })
}
