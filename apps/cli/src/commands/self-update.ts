import Update from './update.js'

/**
 * Backward-compatible alias for `prlt update`.
 * `prlt self-update` continues to work but `prlt update` is now the primary command.
 */
export default class SelfUpdate extends Update {
  static hidden = true

  static description = 'Alias for "prlt update"'

  static examples = [
    '<%= config.bin %> update',
    '<%= config.bin %> update --check',
    '<%= config.bin %> update --force',
  ]
}
