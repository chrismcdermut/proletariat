import chalk from 'chalk';
import inquirer from 'inquirer';
import { spawn } from 'node:child_process';
import { detectAITools, type ToolDetectionResult, type DetectedTool } from './detect-tools.js';
import {
  outputSuccessAsJson,
  createMetadata,
  type PromptChoice,
} from '../prompt-json.js';

export interface OnboardingResult {
  /** How the user chose to set up: 'ai' or 'manual' */
  method: 'ai' | 'manual';
  /** Which AI tool was selected (if method is 'ai') */
  tool?: DetectedTool;
  /** Whether the AI setup was spawned successfully */
  spawned?: boolean;
}

/**
 * Build the setup choices based on detected AI tools.
 */
function buildSetupChoices(detection: ToolDetectionResult): PromptChoice[] {
  const choices: PromptChoice[] = [];

  if (detection.hasClaudeCode) {
    const tool = detection.tools.find(t => t.name === 'claude-code')!;
    choices.push({
      name: `Agent-guided setup with Claude Code (${tool.path})`,
      value: 'claude-code',
    });
  }

  if (detection.hasCodex) {
    const tool = detection.tools.find(t => t.name === 'codex')!;
    choices.push({
      name: `Agent-guided setup with Codex (${tool.path})`,
      value: 'codex',
    });
  }

  choices.push({
    name: 'Manual config (step-by-step prompts)',
    value: 'manual',
  });

  return choices;
}

const SETUP_PROMPT = `You are helping a user set up Proletariat HQ for the first time.
Run the following commands to create their headquarters:

1. Run: prlt new
2. Follow the interactive prompts to configure the HQ name, agents, repos, and PMO.
3. When done, show them how to create their first ticket: prlt ticket create
4. Show them how to spawn their first agent: prlt work spawn

Be helpful and guide them through each step. If any step fails, explain what went wrong and how to fix it.`;

/**
 * Spawn an AI tool to handle the setup automatically.
 * Runs interactively so the user can see and interact with the AI.
 */
function spawnAISetup(tool: DetectedTool): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.blue(`\nLaunching ${tool.displayName} to set up your HQ...\n`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log('');

    const child = spawn(tool.command, ['--print', SETUP_PROMPT], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', (code) => {
      console.log('');
      console.log(chalk.gray('─'.repeat(60)));
      if (code === 0) {
        console.log(chalk.green('\nAI-assisted setup complete!\n'));
        resolve(true);
      } else {
        console.log(chalk.yellow('\nAI setup exited. You can run `prlt new` to set up manually.\n'));
        resolve(false);
      }
    });

    child.on('error', (err) => {
      console.log(chalk.red(`\nFailed to launch ${tool.displayName}: ${err.message}`));
      console.log(chalk.yellow('You can run `prlt new` to set up manually.\n'));
      resolve(false);
    });
  });
}

/**
 * Show the welcome message and brief explainer for first-time users.
 */
function showWelcome(): void {
  console.log('');
  console.log(chalk.bold.blue('  Welcome to Proletariat — AI agent orchestration'));
  console.log('');
  console.log(chalk.white('  Proletariat orchestrates AI coding agents across your projects.'));
  console.log(chalk.white('  It manages a workspace called an HQ (headquarters) that holds'));
  console.log(chalk.white('  your repositories, agents, and project tracking in one place.'));
  console.log('');
  console.log(chalk.gray('  • An HQ is your central hub for managing AI agents'));
  console.log(chalk.gray('  • Agents work on tickets — they read, code, and create PRs'));
  console.log(chalk.gray('  • You can watch, guide, and review their work in real time'));
  console.log('');
}

/**
 * Run the onboarding wizard in interactive (human) mode.
 * Shows welcome, explainer, and lets user choose setup method.
 *
 * @returns The onboarding result indicating how the user chose to proceed
 */
export async function runOnboardingWizard(): Promise<OnboardingResult> {
  // Step 1: Welcome + explainer
  showWelcome();

  console.log(chalk.blue('  Let\'s set up your first workspace.\n'));

  // Step 2: Detect AI tools
  const detection = detectAITools();

  if (detection.tools.length > 0) {
    const toolNames = detection.tools.map(t => t.displayName).join(', ');
    console.log(chalk.green(`  Detected: ${toolNames}\n`));
  }

  // Step 3: Setup method choice
  const choices = buildSetupChoices(detection);
  const message = 'How would you like to set up?';

  const { setupMethod } = await inquirer.prompt([{
    type: 'list',
    name: 'setupMethod',
    message,
    choices: choices.map(c => ({ name: c.name, value: c.value })),
  }]);

  if (setupMethod === 'manual') {
    return { method: 'manual' };
  }

  // AI-assisted setup
  const selectedTool = detection.tools.find(t => t.name === setupMethod)!;
  const spawned = await spawnAISetup(selectedTool);

  return {
    method: 'ai',
    tool: selectedTool,
    spawned,
  };
}

/**
 * Handle onboarding in JSON/agent mode.
 * Outputs tool detection results and setup choices as JSON.
 */
export function runOnboardingJsonMode(flags: Record<string, unknown>): void {
  const detection = detectAITools();
  const metadata = createMetadata('new', flags);

  // If a setup method is provided via flag, report success with detection results
  if (flags.setup) {
    const method = flags.setup as string;
    if (method === 'manual') {
      // Don't exit — let caller continue with normal new flow
      return;
    }

    const tool = detection.tools.find(t => t.name === method);
    if (!tool) {
      // Tool not found — return without exiting so caller falls through
      return;
    }

    outputSuccessAsJson({
      method: 'ai',
      tool: tool.name,
      toolCommand: tool.command,
      setupPrompt: SETUP_PROMPT,
      detectedTools: detection.tools.map(t => ({
        name: t.name,
        command: t.command,
        displayName: t.displayName,
      })),
    }, metadata);
    return
  }
}

/**
 * Check if onboarding should run (first-time user with no HQs).
 */
export function isFirstTimeUser(headquartersCount: number, currentHQ: string | null): boolean {
  return headquartersCount === 0 && currentHQ === null;
}
