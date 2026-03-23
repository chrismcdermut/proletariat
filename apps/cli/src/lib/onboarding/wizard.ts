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

const SETUP_PROMPT = `You are helping a user set up Proletariat (prlt) for the first time.

## What is Proletariat?

Proletariat is an AI agent orchestration platform. It manages a "headquarters" (HQ) — a directory that contains:
- repos/ — cloned git repositories your agents work on
- agents/ — isolated workspaces (Docker containers or git worktrees) for each AI agent
- pmo/ — a project management office with a kanban board for tracking tickets
- .proletariat/ — config and a SQLite database

## Prerequisites

Before starting, the user needs:
- Docker running (agents run in containers)
- A PMO account (Linear, Jira, ClickUp, Trello, or Monday) — optional but recommended

## Setup Steps

1. Run: prlt new --name <project-name>
   This creates the HQ directory structure. Choose a descriptive name (e.g., "acme-app").
   The HQ will be created at ./<name>-hq/ by default.

2. Once the HQ is created, cd into it:
   cd <name>-hq

3. Connect a PMO provider (optional but recommended):
   prlt linear connect    # for Linear
   prlt jira connect      # for Jira
   prlt asana connect     # for Asana
   prlt monday connect    # for Monday.com
   prlt trello connect    # for Trello
   prlt shortcut connect  # for Shortcut

4. Add repositories:
   prlt repo add <path-or-url>

5. Create a first ticket:
   prlt ticket create --title "My first task"

6. Spawn an agent to work on it:
   prlt work implement TKT-1

## What Happens Next

After setup, the typical workflow is:
  prlt ticket create → prlt work implement → agent works → prlt pr → code review → merge

The PMO provider and AI tool preferences are stored per-HQ, not machine-wide.

Guide the user through each step. If any step fails, explain what went wrong and how to fix it.
After setup is complete, remind the user to cd into their new HQ directory.`;

/**
 * Build the command-line arguments for spawning an AI tool.
 * Each tool has its own CLI interface for passing a system prompt.
 */
function buildToolArgs(tool: DetectedTool): string[] {
  if (tool.name === 'claude-code') {
    return ['--print', SETUP_PROMPT];
  }
  if (tool.name === 'codex') {
    return ['--prompt', SETUP_PROMPT];
  }
  // Fallback: pass as positional argument
  return [SETUP_PROMPT];
}

/**
 * Spawn an AI tool to handle the setup automatically.
 * Runs interactively so the user can see and interact with the AI.
 */
function spawnAISetup(tool: DetectedTool): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.blue(`\nLaunching ${tool.displayName} to set up your HQ...\n`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log('');

    const args = buildToolArgs(tool);
    const child = spawn(tool.command, args, {
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
  const metadata = createMetadata('new', flags);

  // If a setup method is provided via flag, report success with detection results
  if (flags.setup) {
    const method = flags.setup as string;
    if (method === 'manual') {
      // Don't exit — let caller continue with normal init agent mode
      return;
    }

    const tool = detection.tools.find(t => t.name === method);
    if (!tool) {
      outputPromptAsJson(
        buildPromptConfig('list', 'setup', 'How would you like to set up your headquarters?', choices),
        metadata,
      );
      return
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
    return
  }

  // No setup method provided — output a prompt with available choices
  outputPromptAsJson(
    buildPromptConfig('list', 'setup', 'How would you like to set up your headquarters?', choices),
    metadata,
  );
  return
}

/**
 * Check if onboarding should run (first-time user with no HQs).
 */
export function isFirstTimeUser(headquartersCount: number, currentHQ: string | null): boolean {
  return headquartersCount === 0 && currentHQ === null;
}
