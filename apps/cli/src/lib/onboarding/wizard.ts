import chalk from 'chalk';
import inquirer from 'inquirer';
import { spawn } from 'node:child_process';
import { detectAITools, type ToolDetectionResult, type DetectedTool } from './detect-tools.js';
import {
  outputPromptAsJson,
  outputSuccessAsJson,
  buildPromptConfig,
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
      name: `Let Claude Code set it up (${tool.path})`,
      value: 'claude-code',
    });
  }

  if (detection.hasCodex) {
    const tool = detection.tools.find(t => t.name === 'codex')!;
    choices.push({
      name: `Let Codex set it up (${tool.path})`,
      value: 'codex',
    });
  }

  choices.push({
    name: 'Set up manually (guided walkthrough)',
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
 * Spawn an AI tool to handle the setup interactively.
 * The user can see and interact with the AI.
 */
function spawnAISetup(tool: DetectedTool): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.blue(`\nLaunching ${tool.displayName} to set up your HQ...\n`));
    console.log(chalk.gray('\u2500'.repeat(60)));
    console.log('');

    const args = tool.name === 'claude-code'
      ? ['-p', SETUP_PROMPT]
      : [SETUP_PROMPT];

    const child = spawn(tool.command, args, {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', (code) => {
      console.log('');
      console.log(chalk.gray('\u2500'.repeat(60)));
      if (code === 0) {
        console.log(chalk.green('\nAI-assisted setup complete!\n'));
        resolve(true);
      } else {
        console.log(chalk.yellow('\nAI setup exited. You can run `prlt init` again to retry.\n'));
        resolve(false);
      }
    });

    child.on('error', (err) => {
      console.log(chalk.red(`\nFailed to launch ${tool.displayName}: ${err.message}`));
      console.log(chalk.yellow('You can run `prlt init` again to set up manually.\n'));
      resolve(false);
    });
  });
}

/**
 * Run the onboarding wizard in interactive (human) mode.
 * Detects AI tools and lets the user choose how to set up.
 *
 * @returns The onboarding result, or null if user chose manual (caller should continue with normal init)
 */
export async function runOnboardingWizard(): Promise<OnboardingResult> {
  console.log(chalk.blue('Welcome to Proletariat!\n'));
  console.log(chalk.gray('  Proletariat helps you manage AI coding agents across your projects.\n'));

  // Detect installed AI tools
  console.log(chalk.gray('  Detecting AI tools...\n'));
  const detection = detectAITools();

  if (detection.tools.length > 0) {
    const toolNames = detection.tools.map(t => t.displayName).join(', ');
    console.log(chalk.green(`  Found: ${toolNames}\n`));
  } else {
    console.log(chalk.gray('  No AI tools detected. Proceeding with manual setup.\n'));
    return { method: 'manual' };
  }

  // Build choices and prompt
  const choices = buildSetupChoices(detection);
  const message = 'How would you like to set up your headquarters?';

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
  const choices = buildSetupChoices(detection);
  const metadata = createMetadata('init', flags);

  // If a setup method is provided via flag, report success with detection results
  if (flags.setup) {
    const method = flags.setup as string;
    if (method === 'manual') {
      // Don't exit - let caller continue with normal init agent mode
      return;
    }

    const tool = detection.tools.find(t => t.name === method);
    if (!tool) {
      outputPromptAsJson(
        buildPromptConfig('list', 'setup', 'How would you like to set up your headquarters?', choices),
        metadata,
      );
      // never reaches here - outputPromptAsJson exits
    }

    outputSuccessAsJson({
      method: 'ai',
      tool: tool!.name,
      toolCommand: tool!.command,
      setupPrompt: SETUP_PROMPT,
      detectedTools: detection.tools.map(t => ({
        name: t.name,
        command: t.command,
        displayName: t.displayName,
      })),
    }, metadata);
    // never reaches here - outputSuccessAsJson exits
  }

  // No setup method provided - output a prompt with available choices
  outputPromptAsJson(
    buildPromptConfig('list', 'setup', 'How would you like to set up your headquarters?', choices),
    metadata,
  );
  // never reaches here - outputPromptAsJson exits
}

/**
 * Check if onboarding should run (first-time user with no HQs).
 */
export function isFirstTimeUser(headquartersCount: number, currentHQ: string | null): boolean {
  return headquartersCount === 0 && currentHQ === null;
}
