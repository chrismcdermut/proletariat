import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { SpecType, SpecStatus } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { multiLineInput } from '../../lib/multiline-input.js';

export default class SpecEdit extends PMOCommand {
  static description = 'Edit an existing spec';

  static examples = [
    '<%= config.bin %> <%= command.id %> user-authentication',
    '<%= config.bin %> <%= command.id %> --spec api-design --title "New API Design"',
    '<%= config.bin %> <%= command.id %> user-auth --status active',
    '<%= config.bin %> <%= command.id %> user-auth --type product --problem "Need better auth"',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
  ];

  static args = {
    spec: Args.string({
      description: 'Spec ID to edit',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    spec: Flags.string({
      char: 's',
      description: 'Spec ID to edit',
    }),
    title: Flags.string({
      char: 't',
      description: 'New spec title',
    }),
    status: Flags.string({
      description: 'Spec status',
      options: ['draft', 'active', 'implemented'],
    }),
    type: Flags.string({
      description: 'Spec type',
      options: ['product', 'platform', 'infra', 'integration', 'none'],
    }),
    problem: Flags.string({
      description: 'Problem statement',
    }),
    solution: Flags.string({
      description: 'Solution description',
    }),
    decisions: Flags.string({
      description: 'Design decisions',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompts for all fields',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecEdit);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec edit', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get spec ID from args or flags
    let specId = args.spec || flags.spec;

    if (!specId) {
      // List specs for selection
      const specs = await this.storage.listSpecs();

      if (specs.length === 0) {
        return handleError('NO_SPECS', 'No specs found. Create one first with: prlt spec create');
      }

      // Use FlagResolver for spec selection
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec edit',
        baseCommand: 'prlt spec edit',
        jsonMode,
        flags: { spec: flags.spec },
      });

      resolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec to edit:',
        choices: () => specs.map(s => ({
          name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
          value: s.id,
        })),
      });

      const resolved = await resolver.resolve();
      specId = resolved.spec;
    }

    // Get current spec
    const spec = await this.storage.getSpec(specId!);
    if (!spec) {
      return handleError('NOT_FOUND', `Spec "${specId}" not found.`);
    }

    // Build choices for prompts
    const typeChoices = [
      { name: 'Product (user-facing feature)', value: 'product' },
      { name: 'Platform (internal tooling)', value: 'platform' },
      { name: 'Infra (technical infrastructure)', value: 'infra' },
      { name: 'Integration (external service)', value: 'integration' },
      { name: 'None', value: '' },
    ];
    const statusChoices = [
      { name: 'Draft (planning)', value: 'draft' },
      { name: 'Active (in progress)', value: 'active' },
      { name: 'Implemented (complete)', value: 'implemented' },
    ];

    // Determine what to update
    let updates: Partial<{
      title: string;
      status: SpecStatus;
      type: SpecType | undefined;
      problem: string;
      solution: string;
      decisions: string;
    }> = {};

    const hasFlags = flags.title || flags.status || flags.type || flags.problem ||
      flags.solution || flags.decisions;

    if (flags.interactive || !hasFlags) {
      // In JSON mode without flags, output a form prompt instead of interactive prompts
      if (jsonMode) {
        const { outputPromptAsJson, buildFormPromptConfig } = await import('../../lib/prompt-json.js');
        const formConfig = buildFormPromptConfig([
          { type: 'input', name: 'title', message: 'Title:', default: spec.title },
          { type: 'list', name: 'status', message: 'Status:', choices: statusChoices, default: spec.status },
          { type: 'list', name: 'type', message: 'Type:', choices: typeChoices, default: spec.type || '' },
          { type: 'multiline', name: 'problem', message: 'Problem statement:', default: spec.problem || '' },
          { type: 'multiline', name: 'solution', message: 'Solution:', default: spec.solution || '' },
          { type: 'multiline', name: 'decisions', message: 'Design decisions:', default: spec.decisions || '' },
        ]);
        formConfig.context = {
          hint: `Edit spec with: prlt spec edit ${specId} --title "..." --problem "..." --json`,
          specId,
          currentValues: { title: spec.title, status: spec.status, type: spec.type, problem: spec.problem, solution: spec.solution, decisions: spec.decisions },
        };
        outputPromptAsJson(formConfig, createMetadata('spec edit', flags));
        return; // outputPromptAsJson exits, but TypeScript doesn't know
      }

      // Interactive mode - prompt for editable fields
      updates = await this.promptForEdits(spec, typeChoices, statusChoices);
    } else {
      // Use flag values
      if (flags.title) updates.title = flags.title;
      if (flags.status) updates.status = flags.status as SpecStatus;
      if (flags.type) {
        updates.type = flags.type === 'none' ? undefined : flags.type as SpecType;
      }
      if (flags.problem) updates.problem = flags.problem;
      if (flags.solution) updates.solution = flags.solution;
      if (flags.decisions) updates.decisions = flags.decisions;
    }

    // Check if anything changed
    if (Object.keys(updates).length === 0) {
      this.log(styles.muted('\nNo changes made.'));
      return;
    }

    // Update the spec
    const updatedSpec = await this.storage.updateSpec(specId!, updates);

    // Display updated spec
    this.log(styles.success(`\n✅ Updated spec "${styles.emphasis(updatedSpec.title)}"`));

    const changedFields: string[] = [];
    if (updates.title) changedFields.push(`Title: ${updatedSpec.title}`);
    if (updates.status) changedFields.push(`Status: ${updatedSpec.status}`);
    if (updates.type !== undefined) changedFields.push(`Type: ${updatedSpec.type || 'none'}`);
    if (updates.problem !== undefined) changedFields.push(`Problem: ${updates.problem ? 'updated' : '(cleared)'}`);
    if (updates.solution !== undefined) changedFields.push(`Solution: ${updates.solution ? 'updated' : '(cleared)'}`);
    if (updates.decisions !== undefined) changedFields.push(`Decisions: ${updates.decisions ? 'updated' : '(cleared)'}`);

    for (const field of changedFields) {
      this.log(styles.muted(`   ${field}`));
    }

    this.log('');
    this.log(styles.muted(`View spec: prlt spec view ${updatedSpec.id}`));
  }

  private async promptForEdits(
    spec: {
      title: string;
      status: SpecStatus;
      type?: SpecType;
      problem?: string;
      solution?: string;
      decisions?: string;
    },
    typeChoices: { name: string; value: string }[],
    statusChoices: { name: string; value: string }[]
  ): Promise<{
    title?: string;
    status?: SpecStatus;
    type?: SpecType | undefined;
    problem?: string;
    solution?: string;
    decisions?: string;
  }> {
    // First prompt for title, status, and type
    const basicAnswers = await this.prompt<{
      title: string;
      status: string;
      type: string;
    }>([
      {
        type: 'input',
        name: 'title',
        message: 'Title:',
        default: spec.title,
        validate: (input: unknown) => (input as string).length > 0 || 'Title is required',
      },
      {
        type: 'list',
        name: 'status',
        message: 'Status:',
        choices: statusChoices,
        default: spec.status,
      },
      {
        type: 'list',
        name: 'type',
        message: 'Type:',
        choices: typeChoices,
        default: spec.type || '',
      },
    ], null);

    // Prompt for problem statement using multiline input
    const problemResult = await multiLineInput({
      message: 'Problem statement:',
      default: spec.problem || '',
      hint: 'Describe the problem this spec addresses. Ctrl+D to finish, Ctrl+C to cancel',
    });

    if (problemResult.cancelled) {
      throw new Error('Edit cancelled');
    }

    // Prompt for solution using multiline input
    const solutionResult = await multiLineInput({
      message: 'Solution:',
      default: spec.solution || '',
      hint: 'Describe the proposed solution. Ctrl+D to finish, Ctrl+C to cancel',
    });

    if (solutionResult.cancelled) {
      throw new Error('Edit cancelled');
    }

    // Prompt for decisions using multiline input
    const decisionsResult = await multiLineInput({
      message: 'Design decisions:',
      default: spec.decisions || '',
      hint: 'Document key design decisions. Ctrl+D to finish, Ctrl+C to cancel',
    });

    if (decisionsResult.cancelled) {
      throw new Error('Edit cancelled');
    }

    // Build updates object with only changed fields
    const updates: {
      title?: string;
      status?: SpecStatus;
      type?: SpecType | undefined;
      problem?: string;
      solution?: string;
      decisions?: string;
    } = {};

    if (basicAnswers.title !== spec.title) {
      updates.title = basicAnswers.title;
    }
    if (basicAnswers.status !== spec.status) {
      updates.status = basicAnswers.status as SpecStatus;
    }

    const newType = basicAnswers.type === '' ? undefined : basicAnswers.type as SpecType;
    if (newType !== spec.type) {
      updates.type = newType;
    }
    if (problemResult.value !== (spec.problem || '')) {
      // Preserve empty string to allow clearing the field
      updates.problem = problemResult.value;
    }
    if (solutionResult.value !== (spec.solution || '')) {
      // Preserve empty string to allow clearing the field
      updates.solution = solutionResult.value;
    }
    if (decisionsResult.value !== (spec.decisions || '')) {
      // Preserve empty string to allow clearing the field
      updates.decisions = decisionsResult.value;
    }

    return updates;
  }
}
