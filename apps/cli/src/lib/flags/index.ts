/**
 * FlagResolver - Unified flag resolution for human and machine modes
 *
 * Exports the FlagResolver class and related types for building commands
 * that work seamlessly in both interactive (TTY) and JSON (non-TTY/agent) modes.
 *
 * @example
 * ```typescript
 * import { FlagResolver } from '../../lib/flags/index.js'
 *
 * const resolver = new FlagResolver({
 *   commandName: 'ticket create',
 *   baseCommand: 'prlt ticket create',
 *   flags,
 * })
 *
 * const result = await resolver
 *   .define({
 *     name: 'column',
 *     type: 'string',
 *     promptType: 'list',
 *     message: 'Select column:',
 *     choices: () => columns.map(c => ({ name: c, value: c })),
 *     required: true,
 *   })
 *   .resolve()
 *
 * if (!result.complete) return  // JSON output was emitted
 *
 * const { column } = result.values
 * ```
 */

export { FlagResolver } from './resolver.js'

export type {
  FlagDefinition,
  FlagResolverOptions,
  FlagValue,
  FlagChoice,
  ResolverContext,
  ResolvedFlags,
  PromptType,
} from './types.js'
