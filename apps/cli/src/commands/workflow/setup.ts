import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
  isMachineOutput,
  type PromptChoice,
} from '../../lib/prompt-json.js';
import {
  loadDefaultWorkSource,
  getRegisteredWorkSources,
  type WorkSourceProvider,
} from '../../lib/work-source/config.js';
import {
  LinearClient,
  isLinearConfigured,
  loadLinearConfig,
  getLinearApiKey,
  type LinearWorkflowState,
} from '../../lib/linear/index.js';
import type { StateCategory, WorkAction } from '../../lib/pmo/types.js';

/**
 * Map Linear state type → PMO StateCategory
 */
const LINEAR_TYPE_TO_CATEGORY: Record<string, StateCategory> = {
  triage: 'triage',
  backlog: 'backlog',
  unstarted: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
};

/**
 * Suggest a default action for a state based on its category.
 * Returns action ID or null for "no action".
 */
function suggestDefaultAction(
  category: StateCategory,
  stateName: string,
): { actionId: string | null; label: string } {
  // Review doesn't need an on_enter action — the implement lifecycle hook
  // moves tickets there when a PR is created
  const lowerName = stateName.toLowerCase();
  if (lowerName === 'review' || lowerName === 'in review') {
    return { actionId: null, label: 'No auto-action (implement moves here on PR)' };
  }

  switch (category) {
    case 'triage':
      return { actionId: null, label: 'No action (manual triage)' };
    case 'backlog':
      return { actionId: 'groom', label: 'groom (Recommended)' };
    case 'unstarted':
      return { actionId: null, label: 'No action' };
    case 'started':
      return { actionId: 'implement', label: 'implement (Recommended)' };
    case 'completed':
      return { actionId: 'merge', label: 'merge (Recommended)' };
    case 'canceled':
      return { actionId: null, label: 'No action' };
    default:
      return { actionId: null, label: 'No action' };
  }
}

interface StateWiring {
  stateName: string;
  category: StateCategory;
  actionId: string | null;
  trigger: 'manual' | 'on_enter';
}

export default class WorkflowSetup extends PMOCommand {
  static description = 'Pull board states from provider and wire actions to state transitions';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --accept-defaults',
    '<%= config.bin %> <%= command.id %> --machine',
  ];

  static flags = {
    ...pmoBaseFlags,
    'accept-defaults': Flags.boolean({
      description: 'Accept all default action suggestions without prompting',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkflowSetup);
    const jsonMode = shouldOutputJson(flags);
    const db = this.storage.getDatabase();

    // 1. Determine connected provider
    const defaultSource = loadDefaultWorkSource(db);
    let provider: WorkSourceProvider | null = defaultSource?.provider ?? null;

    if (!provider || provider === 'pmo') {
      // Try to find any registered external source
      const sources = getRegisteredWorkSources(db);
      const external = sources.filter(s => s.provider !== 'pmo');
      if (external.length === 1) {
        provider = external[0].provider;
      } else if (external.length > 1) {
        // In JSON mode, output choices
        if (jsonMode) {
          const choices: PromptChoice[] = external.map(s => ({
            name: `${s.provider}${s.context ? ` (${s.context})` : ''}`,
            value: s.provider,
          }));
          outputPromptAsJson(
            buildPromptConfig('list', 'provider', 'Select provider to pull states from:', choices),
            createMetadata('workflow setup', flags),
          );
          return;
        }

        const { selectedProvider } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedProvider',
          message: 'Select provider to pull states from:',
          choices: external.map(s => ({
            name: `${s.provider}${s.context ? ` (${s.context})` : ''}`,
            value: s.provider,
          })),
        }]);
        provider = selectedProvider;
      } else {
        const msg = 'No external provider connected. Run "prlt linear connect" (or jira/asana) first.';
        if (jsonMode) {
          outputErrorAsJson('NO_PROVIDER', msg, createMetadata('workflow setup', flags));
        }
        this.error(msg);
      }
    }

    // 2. Fetch workflow states from provider
    let providerStates: Array<{ name: string; category: StateCategory; position: number }> = [];
    let providerLabel = '';

    if (provider === 'linear') {
      const linearApiKey = getLinearApiKey(db);
      if (!linearApiKey || !isLinearConfigured(db)) {
        const msg = 'Linear is not configured. Run "prlt linear connect" first.';
        if (jsonMode) {
          outputErrorAsJson('LINEAR_NOT_CONFIGURED', msg, createMetadata('workflow setup', flags));
        }
        this.error(msg);
      }

      const linearConfig = loadLinearConfig(db)!;
      const client = new LinearClient(linearApiKey!);

      // Get team ID
      let teamId = linearConfig.defaultTeamId;
      if (!teamId) {
        const teams = await client.listTeams();
        if (teams.length === 0) {
          const msg = 'No Linear teams found.';
          if (jsonMode) {
            outputErrorAsJson('NO_TEAMS', msg, createMetadata('workflow setup', flags));
          }
          this.error(msg);
        }
        teamId = teams[0].id;
        providerLabel = `Linear (${teams[0].name} team)`;
      } else {
        providerLabel = `Linear (${linearConfig.defaultTeamKey ?? 'default'} team)`;
      }

      const states = await client.listStates(teamId);
      // Sort by position
      states.sort((a, b) => a.position - b.position);

      providerStates = states.map(s => ({
        name: s.name,
        category: LINEAR_TYPE_TO_CATEGORY[s.type] || 'backlog' as StateCategory,
        position: s.position,
      }));
    } else {
      // For now, only Linear is fully supported for state fetching.
      // Other providers can be added later.
      const msg = `Provider "${provider}" is not yet supported for workflow setup. Currently supported: linear`;
      if (jsonMode) {
        outputErrorAsJson('UNSUPPORTED_PROVIDER', msg, createMetadata('workflow setup', flags));
      }
      this.error(msg);
    }

    if (providerStates.length === 0) {
      const msg = 'No workflow states found from provider.';
      if (jsonMode) {
        outputErrorAsJson('NO_STATES', msg, createMetadata('workflow setup', flags));
      }
      this.error(msg);
    }

    // 3. Get available actions for building choices
    const allActions = await this.storage.listActions();

    // 4. Build default wiring based on category
    const wirings: StateWiring[] = providerStates.map(state => {
      const suggestion = suggestDefaultAction(state.category, state.name);
      return {
        stateName: state.name,
        category: state.category,
        actionId: suggestion.actionId,
        trigger: suggestion.actionId ? 'manual' : 'manual',
      };
    });

    // 5. Display states and defaults
    if (!jsonMode) {
      this.log('');
      this.log(styles.emphasis(`Connected to: ${providerLabel}`));
      this.log('');
      this.log(styles.emphasis('Your board states:'));

      for (const wiring of wirings) {
        const suggestion = suggestDefaultAction(wiring.category, wiring.stateName);
        const arrow = '\u2190';
        this.log(`  ${styles.emphasis(wiring.stateName)} ${styles.muted(`(${wiring.category})`)} ${arrow} ${styles.muted(suggestion.label)}`);
      }
      this.log('');
    }

    // 6. Accept defaults or customize
    if (!flags['accept-defaults'] && !jsonMode) {
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'How would you like to proceed?',
        choices: [
          { name: 'Accept defaults', value: 'accept' },
          { name: 'Customize each state', value: 'customize' },
        ],
      }]);

      if (action === 'customize') {
        await this.customizeWirings(wirings, allActions);
      }
    } else if (jsonMode) {
      // In JSON mode, output the default wiring plan for review
      const plan = wirings.map(w => ({
        state: w.stateName,
        category: w.category,
        action: w.actionId ?? 'none',
        trigger: w.trigger,
      }));

      outputSuccessAsJson(
        {
          provider: provider,
          providerLabel,
          states: plan,
          message: 'Default wiring plan. Use --accept-defaults to apply, or run interactively to customize.',
        },
        createMetadata('workflow setup', flags),
      );
      return;
    }

    // 7. Save wiring to workflow_rules table (re-runnable: delete existing rules first)
    await this.saveWirings(wirings);

    if (!jsonMode) {
      this.log('');
      this.log(styles.success('Workflow rules saved successfully!'));
      this.log('');

      // Show summary
      const activeRules = wirings.filter(w => w.actionId);
      if (activeRules.length > 0) {
        this.log(styles.emphasis('Active rules:'));
        for (const rule of activeRules) {
          this.log(`  ${styles.muted(`${rule.stateName} \u2192 ${rule.actionId} (${rule.trigger})`)}`);
        }
      }

      const skippedStates = wirings.filter(w => !w.actionId);
      if (skippedStates.length > 0) {
        this.log('');
        this.log(styles.muted(`States with no action: ${skippedStates.map(s => s.stateName).join(', ')}`));
      }

      this.log('');
      this.log(styles.muted('View rules: prlt workflow rules'));
      this.log(styles.muted('Re-run setup: prlt workflow setup'));
    }
  }

  /**
   * Let user customize the action for each state.
   */
  private async customizeWirings(wirings: StateWiring[], allActions: WorkAction[]): Promise<void> {
    for (const wiring of wirings) {
      const suggestion = suggestDefaultAction(wiring.category, wiring.stateName);

      const choices = [
        { name: 'No action', value: '__none__' },
        ...allActions.map(a => ({
          name: `${a.id}${a.id === suggestion.actionId ? ' (Recommended)' : ''} — ${a.description || a.name}`,
          value: a.id,
        })),
      ];

      // Set default to recommended action or 'No action'
      const defaultValue = suggestion.actionId ?? '__none__';

      // eslint-disable-next-line no-await-in-loop
      const { selectedAction } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedAction',
        message: `Action for "${wiring.stateName}" (${wiring.category}):`,
        choices,
        default: defaultValue,
      }]);

      wiring.actionId = selectedAction === '__none__' ? null : selectedAction;

      // If an action was selected, ask for trigger type
      if (wiring.actionId) {
        // eslint-disable-next-line no-await-in-loop
        const { selectedTrigger } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTrigger',
          message: `Trigger for "${wiring.stateName}" \u2192 ${wiring.actionId}:`,
          choices: [
            { name: 'Manual — agent picks up work when assigned', value: 'manual' },
            { name: 'On enter — fires automatically when ticket enters this state', value: 'on_enter' },
          ],
          default: 'manual',
        }]);

        wiring.trigger = selectedTrigger;
      }
    }
  }

  /**
   * Save wirings to the workflow_rules table.
   * Re-runnable: deletes all existing rules with matching IDs before creating new ones.
   */
  private async saveWirings(wirings: StateWiring[]): Promise<void> {
    // Delete existing setup-generated rules (those with 'setup-' prefix)
    const existingRules = await this.storage.listWorkflowRules();
    for (const rule of existingRules) {
      if (rule.id.startsWith('setup-')) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.deleteWorkflowRule(rule.id);
      }
    }

    // Create new rules for states with actions
    for (const wiring of wirings) {
      if (!wiring.actionId) continue;

      const ruleId = `setup-${wiring.stateName.toLowerCase().replace(/\s+/g, '-')}-${wiring.actionId}`;

      try {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.createWorkflowRule({
          id: ruleId,
          fromState: undefined, // any source state
          toState: wiring.stateName,
          actionId: wiring.actionId,
          trigger: wiring.trigger,
          enabled: true,
        });
      } catch (error) {
        // If a rule with this ID already exists (e.g. from a re-run race), update it
        if (error instanceof Error && error.message.includes('already exists')) {
          // eslint-disable-next-line no-await-in-loop
          await this.storage.updateWorkflowRule(ruleId, {
            toState: wiring.stateName,
            actionId: wiring.actionId,
            trigger: wiring.trigger,
            enabled: true,
          });
        } else {
          throw error;
        }
      }
    }
  }
}
