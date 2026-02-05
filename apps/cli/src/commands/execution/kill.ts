import ExecutionStop from './stop.js'

/**
 * Alias for 'execution stop' command.
 * Users intuitively try 'execution kill' so this provides a familiar interface.
 */
export default class ExecutionKill extends ExecutionStop {
  static description = 'Stop running execution(s) (alias for "execution stop")'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> WORK-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --all --force',
    '<%= config.bin %> <%= command.id %> --agent altman',
  ]

  // Inherits all args, flags, and execute() from ExecutionStop
}
