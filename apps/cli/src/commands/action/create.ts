import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { ActionExecutor, ActionEnvironment, ActionPermissionMode } from '../../lib/pmo/types.js';
import { shouldOutputJson, outputErrorAsJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ActionCreate extends PMOCommand {
  static description = 'Create a new work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Security Review" --prompt "Review for vulnerabilities..."',
    '<%= config.bin %> <%= command.id %> "Write Docs" --prompt "Document this feature..." --from-state "Done"',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new action',
      required: false,  // Not required - will prompt if missing
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    prompt: Flags.string({
      char: 'p',
      description: 'The prompt to send to the agent [required for non-interactive]',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Short description of what this action does',
    }),
    'from-state': Flags.string({
      description: 'State name this action is suggested for (empty = any state)',
    }),
    'to-state': Flags.string({
      description: 'State name to move ticket to after action completes',
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
      description: 'Model override (let executor pick default if not set)',
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
    const { args, flags } = await this.parse(ActionCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let prompt = flags.prompt;
    let description = flags.description;
    let fromState: string | undefined = flags['from-state'];
    let toState: string | undefined = flags['to-state'];
    let executor: ActionExecutor | undefined = flags.executor as ActionExecutor | undefined;
    let environment: ActionEnvironment | undefined = flags.environment as ActionEnvironment | undefined;
    let permissionMode: ActionPermissionMode | undefined = flags['permission-mode'] as ActionPermissionMode | undefined;
    let model: string | undefined = flags.model;

    // Interactive mode if name or prompt is missing
    if (!name || !prompt || flags.interactive) {
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
        commandName: 'action create',
        baseCommand: 'prlt action create',
        jsonMode,
        flags: {
          name,
          prompt,
          description,
          fromState: fromState || '',
          toState: toState || '',
          executor: executor || '',
          environment: environment || '',
          permissionMode: permissionMode || '',
          model: model || '',
        },
      });

      // Name input
      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Action name:',
        default: name,
        when: (ctx) => !ctx.flags.name,
        validate: (value) => (value as string).trim() ? true : 'Name is required',
        context: {
          hint: 'Provide with: prlt action create "Action Name" --prompt "..."',
          requiredFields: ['name (as first argument)', '--prompt'],
        },
      });

      // Prompt input (multiline for inline text input)
      resolver.addPrompt({
        flagName: 'prompt',
        type: 'multiline',
        message: 'Prompt (agent instructions):',
        default: prompt || 'Enter the prompt that will be sent to the agent...',
        when: (ctx) => !ctx.flags.prompt && ctx.flags.name !== undefined,
        validate: (value) => (value as string).trim() ? true : 'Prompt is required',
        context: (ctx) => ({
          hint: `Provide with: prlt action create "${ctx.flags.name}" --prompt "Your prompt here"`,
          requiredFields: ['--prompt'],
          optionalFields: ['--description', '--from-state', '--to-state', '--executor', '--environment', '--permission-mode', '--model'],
        }),
      });

      // Description input (optional, only in full interactive mode)
      if (flags.interactive) {
        resolver.addPrompt({
          flagName: 'description',
          type: 'input',
          message: 'Description (optional):',
          default: description || '',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // From-state input (optional)
        resolver.addPrompt({
          flagName: 'fromState',
          type: 'input',
          message: 'From state (state name to match, empty = any state):',
          default: fromState || '',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // To-state input (optional)
        resolver.addPrompt({
          flagName: 'toState',
          type: 'input',
          message: 'To state (state name to move ticket to after action, empty = no move):',
          default: toState || '',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // Executor list
        resolver.addPrompt({
          flagName: 'executor',
          type: 'list',
          message: 'Executor:',
          choices: () => executorChoices,
          default: executor || 'claude',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // Environment list
        resolver.addPrompt({
          flagName: 'environment',
          type: 'list',
          message: 'Environment:',
          choices: () => environmentChoices,
          default: environment || 'host',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // Permission mode list
        resolver.addPrompt({
          flagName: 'permissionMode',
          type: 'list',
          message: 'Permission mode:',
          choices: () => permissionModeChoices,
          default: permissionMode || 'full',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });
      }

      const resolved = await resolver.resolve();

      name = resolved.name || name;
      prompt = resolved.prompt || prompt;
      description = resolved.description || description;
      fromState = resolved.fromState || fromState;
      toState = resolved.toState || toState;
      executor = (resolved.executor || executor || undefined) as ActionExecutor | undefined;
      environment = (resolved.environment || environment || undefined) as ActionEnvironment | undefined;
      permissionMode = (resolved.permissionMode || permissionMode || undefined) as ActionPermissionMode | undefined;
    }

    if (!name || !prompt) {
      if (jsonMode) {
        outputErrorAsJson('MISSING_REQUIRED', 'Name and prompt are required.', createMetadata('action create', flags));
      }
      this.error('Name and prompt are required.');
    }

    const action = await this.storage.createAction({
      name,
      description,
      prompt,
      fromState: fromState || undefined,
      toState: toState || undefined,
      executor,
      environment,
      permissionMode,
      model,
    });

    if (jsonMode) {
      outputSuccessAsJson({
        id: action.id,
        name: action.name,
        description: action.description ?? null,
        fromState: action.fromState ?? null,
        toState: action.toState ?? null,
        executor: action.executor ?? null,
        environment: action.environment ?? null,
        permissionMode: action.permissionMode ?? null,
        model: action.model ?? null,
        message: `Created action "${action.name}"`,
      }, createMetadata('action create', flags));
      return;
    }

    this.log(styles.success(`\nCreated action "${styles.emphasis(action.name)}" (${action.id})`));
    if (action.description) {
      this.log(styles.muted(`  ${action.description}`));
    }
    if (action.fromState) {
      this.log(styles.muted(`  From state: ${action.fromState}`));
    }
    if (action.toState) {
      this.log(styles.muted(`  To state: ${action.toState}`));
    }
    this.log('');
    this.log(styles.muted(`Use with: prlt work start TKT-001 --action ${action.id}`));
  }
}
