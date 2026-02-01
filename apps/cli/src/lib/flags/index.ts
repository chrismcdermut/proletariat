/**
 * Flag resolution utilities for unified human/machine interactive modes
 */
export {
  FlagResolver,
  createFlagResolver,
  shouldOutputJson,
  isMachineOutput,
  type FlagResolverOptions,
  type PromptDefinition,
  type ResolverChoice,
  type ResolverContext,
  type ResolveResult,
} from './resolver.js';
