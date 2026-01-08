import { Command } from '@oclif/core'
import { isDockerRunning } from '../execution/runners.js'

/**
 * Base command class for commands that require Docker.
 *
 * Automatically checks if Docker daemon is running before the command executes.
 * If Docker is not available, exits with a clear error message.
 *
 * Usage:
 * ```typescript
 * import { DockerCommand } from '../../lib/commands/docker-command.js'
 *
 * export default class MyCommand extends DockerCommand {
 *   async run() {
 *     // Docker is guaranteed to be running here
 *   }
 * }
 * ```
 */
export abstract class DockerCommand extends Command {
  async init(): Promise<void> {
    await super.init()
    if (!isDockerRunning()) {
      this.error('Docker is not running. Please start Docker Desktop and try again.')
    }
  }
}
