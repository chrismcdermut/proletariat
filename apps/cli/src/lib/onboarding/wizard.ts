import chalk from 'chalk';
import inquirer from 'inquirer';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import { detectAITools, type ToolDetectionResult, type DetectedTool } from './detect-tools.js';
import { PMO_PROVIDERS, type PMOProviderValue } from './hq-config.js';
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

/**
 * Build the comprehensive setup prompt for AI-assisted onboarding.
 *
 * This prompt is injected at runtime into the AI session — it does NOT
 * write to CLAUDE.md or any permanent file.
 */
function buildSetupPrompt(detection: ToolDetectionResult): string {
  const detectedToolsList = detection.tools.length > 0
    ? detection.tools.map(t => `  - ${t.displayName} (${t.command}) at ${t.path}`).join('\n')
    : '  (none detected)';

  const providerList = PMO_PROVIDERS
    .filter(p => p.value !== 'none')
    .map(p => {
      return `  - **${p.name}** (value: "${p.value}")
    Connect command: \`${p.connectCommand}\`
    API key URL: ${p.apiKeyUrl}
    Instructions: ${p.apiKeyInstructions}`;
    })
    .join('\n');

  return `You are helping a user set up Proletariat (prlt) — an AI agent orchestration platform that manages coding agents across repositories.

## System Context

prlt organizes work into "Headquarters" (HQs). Each HQ contains:
- **Repos**: Git repositories the agents work on
- **Agents**: AI coding workers (persistent or ephemeral)
- **PMO**: A project management board (kanban) for tracking tickets
- **Integrations**: Optional connections to external providers (Linear, Jira, GitHub Issues, etc.)

## Environment Detection

- OS: ${os.platform()} ${os.arch()}
- Node: ${process.version}
- AI tools detected:
${detectedToolsList}

## Available Commands

| Command | Description |
|---------|-------------|
| \`prlt new --name <name>\` | Create a new HQ |
| \`prlt repo add\` | Add repositories to HQ |
| \`prlt ticket create\` | Create a ticket |
| \`prlt work start <ticket-id>\` | Spawn an agent on a ticket |
| \`prlt config\` | View/update HQ configuration |
| \`prlt linear connect\` | Connect Linear integration |
| \`prlt asana connect\` | Connect Asana integration |
| \`prlt jira connect\` | Connect Jira integration |
| \`prlt trello connect\` | Connect Trello integration |
| \`prlt monday connect\` | Connect Monday.com integration |
| \`prlt shortcut connect\` | Connect Shortcut integration |

## Step-by-Step Setup Flow

Guide the user through these steps in order. After each step, confirm it succeeded before continuing.

### Step 1: Create the HQ

Ask the user for a name (company, project, or team name), then run:

\`\`\`bash
prlt new --name <name>
\`\`\`

This creates the HQ directory structure at \`./<name>-hq/\`.

### Step 2: Navigate into the HQ

\`\`\`bash
cd <name>-hq
\`\`\`

All subsequent commands must run from inside the HQ directory.

### Step 3: Connect a project management provider

The user MUST pick one provider. Ask which one they use:

${providerList}

If they pick "None", that's fine — they'll use the built-in local PMO board.

For any external provider, run the appropriate connect command (e.g. \`prlt linear connect\`).
The connect command will prompt for an API key and validate it. If it fails, show the API key URL and help them troubleshoot.

### Step 4: Add repositories

Run:
\`\`\`bash
prlt repo add
\`\`\`

Help the user add at least one repository. They can provide a local path or a GitHub URL.

### Step 5: Create first ticket

Run:
\`\`\`bash
prlt ticket create --title "My first ticket" --description "Getting started with prlt"
\`\`\`

Or let the user choose their own title and description.

### Step 6: Spawn first agent

Run:
\`\`\`bash
prlt work start <ticket-id>
\`\`\`

Use the ticket ID from Step 5 (e.g., TKT-1).

## Error Recovery

- If \`prlt new\` fails with "inside a git repository": cd to the parent directory first
- If \`prlt new\` fails with "already exists": pick a different name or remove the existing directory
- If a connect command fails with "API key invalid": double-check the key and try again
- If \`prlt repo add\` fails: verify the repo path exists and is a valid git repository
- If \`prlt work start\` fails: ensure Docker is running (agents run in containers by default)

## Important Notes

- Be conversational and encouraging — this is the user's first experience with prlt
- If any step fails, explain what went wrong clearly and help them fix it
- Do NOT write to CLAUDE.md or any permanent config file — this session is ephemeral
- After all steps complete, congratulate the user and summarize what was set up`;
}

/**
 * Spawn an AI tool to handle the setup automatically.
 * Runs interactively so the user can see and interact with the AI.
 */
function spawnAISetup(tool: DetectedTool, detection: ToolDetectionResult): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.blue(`\nLaunching ${tool.displayName} to set up your HQ...\n`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log('');

    const setupPrompt = buildSetupPrompt(detection);

    const child = spawn(tool.command, ['--print', setupPrompt], {
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
  const spawned = await spawnAISetup(selectedTool, detection);

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

    const setupPrompt = buildSetupPrompt(detection);

    outputSuccessAsJson({
      method: 'ai',
      tool: tool.name,
      toolCommand: tool.command,
      setupPrompt,
      pmoProviders: PMO_PROVIDERS.map(p => ({
        name: p.name,
        value: p.value,
        connectCommand: p.connectCommand,
        apiKeyUrl: p.apiKeyUrl,
      })),
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

/**
 * Prompt user to select a PMO provider (interactive mode).
 * Returns the selected provider value.
 */
export async function promptForPMOProvider(): Promise<PMOProviderValue> {
  const choices = PMO_PROVIDERS.map(p => ({
    name: p.value === 'none' ? p.name : `${p.name}`,
    value: p.value,
  }));

  const message = 'Which project management tool do you use?';

  const { provider } = await inquirer.prompt([{
    type: 'list',
    name: 'provider',
    message,
    choices,
  }]);

  return provider as PMOProviderValue;
}

/**
 * Prompt user to select an AI tool (interactive mode).
 * Returns the selected tool info or null if no tools detected.
 */
export async function promptForAITool(detection: ToolDetectionResult): Promise<DetectedTool | null> {
  if (detection.tools.length === 0) {
    return null;
  }

  // If only one tool detected, auto-select it
  if (detection.tools.length === 1) {
    console.log(chalk.gray(`  AI tool: ${detection.tools[0].displayName}\n`));
    return detection.tools[0];
  }

  const choices = detection.tools.map(t => ({
    name: `${t.displayName} (${t.path})`,
    value: t.name,
  }));

  const message = 'Which AI tool should agents use?';

  const { tool } = await inquirer.prompt([{
    type: 'list',
    name: 'tool',
    message,
    choices,
  }]);

  return detection.tools.find(t => t.name === tool) ?? null;
}
