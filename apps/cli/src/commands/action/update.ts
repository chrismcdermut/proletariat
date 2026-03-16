import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { ActionExecutor, ActionEnvironment, ActionPermissionMode } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ActionUpdate extends PMOCommand {
  static description = 'Update a work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-action --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-action --prompt "Updated prompt..."',
    '<%= config.bin %> <%= command.id %> my-action --from-state "In Progress" --to-state "Done"',
    '<%= config.bin %> <%= command.id %> my-action  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Action ID to update',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New action name',
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'New prompt text',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New description',
    }),
    'from-state': Flags.string({
      description: 'State name this action is suggested for (empty = any state)',
    }),
    'to-state': Flags.string({
      description: 'State name to move ticket to after action completes (empty = no move)',
    }),
    executor: Flags.string({
      description: 'Executor to use',
      options: ['claude', 'codex', 'opencode', 'custom'],
    }),
    environment: Flags.string({
      description: 'Execution environment',
      options: ['devcontainer', 'docker', 'host', 'vm'],
    }),
    'permission-mode': Flags.string({
      description: 'Permission mode for the executor',
      options: ['full', 'readonly', 'bypassPermissions'],
    }),
    model: Flags.string({
      description: 'Model override (empty = let executor pick default)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompt for all fields',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionUpdate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('action update', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get current action
    const existingAction = await this.storage.getAction(args.id);
    if (!existingAction) {
      return handleError('ACTION_NOT_FOUND', `Action not found: ${args.id}`);
    }

    if (existingAction.isBuiltin) {
      return handleError('CANNOT_UPDATE_BUILTIN', 'Cannot update built-in actions. Create a custom action instead.');
    }

    const hasFlags = flags.name || flags.prompt || flags.description !== undefined ||
                     flags['from-state'] !== undefined || flags['to-state'] !== undefined ||
                     flags.executor || flags.environment || flags['permission-mode'] || flags.model !== undefined;

    const changes: Partial<{
      name: string
      prompt: string
      description: string
      fromState: string | null
      toState: string | null
      executor: ActionExecutor | null
      environment: ActionEnvironment | null
      permissionMode: ActionPermissionMode | null
      model: string | null
    }> = {};

    // Interactive mode if no flags provided or --interactive flag
    if (!hasFlags || flags.interactive) {
      const executorChoices = [
        { name: 'claude', value: 'claude' },
        { name: 'codex', value: 'codex' },
        { name: 'opencode', value: 'opencode' },
        { name: 'custom', value: 'custom' },
      ];
      const environmentChoices = [
        { name: 'host', value: 'host' },
        { name: 'devcontainer', value: 'devcontainer' },
        { name: 'docker', value: 'docker' },
        { name: 'vm', value: 'vm' },
      ];
      const permissionModeChoices = [
        { name: 'full', value: 'full' },
        { name: 'readonly', value: 'readonly' },
        { name: 'bypassPermissions', value: 'bypassPermissions' },
      ];

      // Use FlagResolver for prompts - works in both JSON and interactive modes
      const resolver = new FlagResolver<{
        name?: string;
        description?: string;
        prompt?: string;
        fromState?: string;
        toState?: string;
        executor?: string;
        environment?: string;
        permissionMode?: string;
        model?: string;
      }>({
        commandName: 'action update',
        baseCommand: `prlt action update ${args.id}`,
        jsonMode,
        flags: {
          name: flags.name,
          description: flags.description,
          prompt: flags.prompt,
          fromState: flags['from-state'],
          toState: flags['to-state'],
          executor: flags.executor,
          environment: flags.environment,
          permissionMode: flags['permission-mode'],
          model: flags.model,
        },
      });

      // Name input
      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Name:',
        default: existingAction.name,
        context: {
          hint: `Provide with: prlt action update ${args.id} --name "New Name"`,
          currentValue: existingAction.name,
        },
      });

      // Description input
      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description:',
        default: existingAction.description || '',
        when: (ctx) => ctx.flags.name !== undefined,
        context: {
          currentValue: existingAction.description || '',
        },
      });

      // Prompt input (multiline)
      resolver.addPrompt({
        flagName: 'prompt',
        type: 'multiline',
        message: 'Prompt (agent instructions):',
        default: existingAction.prompt,
        when: (ctx) => ctx.flags.name !== undefined && ctx.flags.description !== undefined,
        context: {
          hint: `Current prompt length: ${existingAction.prompt.length} chars`,
        },
      });

      // From-state input
      resolver.addPrompt({
        flagName: 'fromState',
        type: 'input',
        message: 'From state (state name to match, empty = any state):',
        default: existingAction.fromState || '',
        when: (ctx) => ctx.flags.prompt !== undefined && ctx.flags.fromState === undefined,
      });

      // To-state input
      resolver.addPrompt({
        flagName: 'toState',
        type: 'input',
        message: 'To state (state name to move ticket to, empty = no move):',
        default: existingAction.toState || '',
        when: (ctx) => ctx.flags.fromState !== undefined && ctx.flags.toState === undefined,
      });

      // Executor list
      resolver.addPrompt({
        flagName: 'executor',
        type: 'list',
        message: 'Executor:',
        choices: () => executorChoices,
        default: existingAction.executor || 'claude',
        when: (ctx) => ctx.flags.toState !== undefined && ctx.flags.executor === undefined,
      });

      // Environment list
      resolver.addPrompt({
        flagName: 'environment',
        type: 'list',
        message: 'Environment:',
        choices: () => environmentChoices,
        default: existingAction.environment || 'host',
        when: (ctx) => ctx.flags.executor !== undefined && ctx.flags.environment === undefined,
      });

      // Permission mode list
      resolver.addPrompt({
        flagName: 'permissionMode',
        type: 'list',
        message: 'Permission mode:',
        choices: () => permissionModeChoices,
        default: existingAction.permissionMode || 'full',
        when: (ctx) => ctx.flags.environment !== undefined && ctx.flags.permissionMode === undefined,
      });

      this.log('');
      this.log(styles.header(`Updating action: ${existingAction.name}`));
      this.log(styles.muted('Press Enter to keep current value, or enter new value.'));
      this.log('');

      const resolved = await resolver.resolve();

      if (resolved.name !== existingAction.name) changes.name = resolved.name;
      if (resolved.description !== (existingAction.description || '')) changes.description = resolved.description;
      if (resolved.prompt !== existingAction.prompt) changes.prompt = resolved.prompt;

      const currentFromState = existingAction.fromState || '';
      if ((resolved.fromState || '') !== currentFromState) {
        changes.fromState = resolved.fromState || null;
      }

      const currentToState = existingAction.toState || '';
      if ((resolved.toState || '') !== currentToState) {
        changes.toState = resolved.toState || null;
      }

      if (resolved.executor && resolved.executor !== existingAction.executor) {
        changes.executor = resolved.executor as ActionExecutor;
      }
      if (resolved.environment && resolved.environment !== existingAction.environment) {
        changes.environment = resolved.environment as ActionEnvironment;
      }
      if (resolved.permissionMode && resolved.permissionMode !== existingAction.permissionMode) {
        changes.permissionMode = resolved.permissionMode as ActionPermissionMode;
      }
    } else {
      // Flag-based update
      if (flags.name) changes.name = flags.name;
      if (flags.prompt) changes.prompt = flags.prompt;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags['from-state'] !== undefined) {
        changes.fromState = flags['from-state'] || null;
      }
      if (flags['to-state'] !== undefined) {
        changes.toState = flags['to-state'] || null;
      }
      if (flags.executor) {
        changes.executor = flags.executor as ActionExecutor;
      }
      if (flags.environment) {
        changes.environment = flags.environment as ActionEnvironment;
      }
      if (flags['permission-mode']) {
        changes.permissionMode = flags['permission-mode'] as ActionPermissionMode;
      }
      if (flags.model !== undefined) {
        changes.model = flags.model || null;
      }
    }

    // Check if any changes
    if (Object.keys(changes).length === 0) {
      this.log(styles.muted('No changes made.'));
      return;
    }

    // Convert null values to undefined for storage layer compatibility
    const updatePayload: Record<string, unknown> = { ...changes };
    for (const [key, value] of Object.entries(updatePayload)) {
      if (value === null) {
        updatePayload[key] = undefined;
      }
    }

    const action = await this.storage.updateAction(args.id, updatePayload);

    this.log(styles.success(`\nUpdated action "${styles.emphasis(action.name)}"`));
    if (changes.name) this.log(styles.muted(`  Name: ${action.name}`));
    if (changes.description !== undefined) this.log(styles.muted(`  Description: ${action.description || '(none)'}`));
    if (changes.prompt) this.log(styles.muted(`  Prompt: (updated)`));
    if (changes.fromState !== undefined) this.log(styles.muted(`  From state: ${action.fromState || '(any)'}`));
    if (changes.toState !== undefined) this.log(styles.muted(`  To state: ${action.toState || '(none)'}`));
    if (changes.executor !== undefined) this.log(styles.muted(`  Executor: ${action.executor || '(default)'}`));
    if (changes.environment !== undefined) this.log(styles.muted(`  Environment: ${action.environment || '(default)'}`));
    if (changes.permissionMode !== undefined) this.log(styles.muted(`  Permission mode: ${action.permissionMode || '(default)'}`));
  }
}
