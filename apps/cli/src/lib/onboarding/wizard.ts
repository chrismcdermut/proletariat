import chalk from 'chalk';
import inquirer from 'inquirer';
import * as os from 'node:os';
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

/** Supported cloud PMO providers */
export const PMO_PROVIDERS = [
  {
    name: 'Linear',
    value: 'linear',
    connectCommand: 'prlt linear connect',
    apiKeyEnvVar: 'LINEAR_API_KEY',
    apiKeyUrl: 'https://linear.app/settings/api',
    apiKeyInstructions: 'Create a Personal API key at https://linear.app/settings/api — keys start with "lin_api_"',
  },
  {
    name: 'Jira',
    value: 'jira',
    connectCommand: 'prlt jira connect',
    apiKeyEnvVar: 'JIRA_API_TOKEN',
    apiKeyUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    apiKeyInstructions: 'Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens — you also need your Jira domain (e.g., yourcompany.atlassian.net)',
  },
  {
    name: 'Trello',
    value: 'trello',
    connectCommand: 'prlt trello configure',
    apiKeyEnvVar: 'TRELLO_API_KEY',
    apiKeyUrl: 'https://trello.com/power-ups/admin',
    apiKeyInstructions: 'Get your API key at https://trello.com/power-ups/admin — you need both an API key and a token',
  },
  {
    name: 'Monday.com',
    value: 'monday',
    connectCommand: 'prlt monday connect',
    apiKeyEnvVar: 'MONDAY_API_TOKEN',
    apiKeyUrl: 'https://monday.com — Admin > API',
    apiKeyInstructions: 'Get your API token from Monday.com: Admin > Integrations > API',
  },
  {
    name: 'Asana',
    value: 'asana',
    connectCommand: 'prlt asana connect',
    apiKeyEnvVar: 'ASANA_ACCESS_TOKEN',
    apiKeyUrl: 'https://app.asana.com/0/my-apps',
    apiKeyInstructions: 'Create a Personal Access Token at https://app.asana.com/0/my-apps',
  },
] as const;

export type PMOProviderValue = typeof PMO_PROVIDERS[number]['value'];

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
 * Build the comprehensive agent-guided onboarding prompt.
 * Context-aware: includes tool detection results, OS info, and existing config state.
 */
function buildSetupPrompt(detection: ToolDetectionResult): string {
  const toolList = detection.tools.map(t => `  - ${t.displayName} (${t.command} at ${t.path})`).join('\n');
  const platform = `${os.platform()} ${os.arch()}`;

  const providerDocs = PMO_PROVIDERS.map(p =>
    `  - **${p.name}**: ${p.apiKeyInstructions}. Connect with: \`${p.connectCommand}\``
  ).join('\n');

  return `You are helping a user set up Proletariat (prlt) for the first time. Proletariat is an AI agent orchestration platform that manages coding agents across repositories.

## Environment
- Platform: ${platform}
- Detected AI tools:
${toolList || '  - None detected'}

## What prlt does
- Creates a "headquarters" (HQ) directory that organizes repos, agents, and project management
- Connects to cloud project management tools (Linear, Jira, Trello, Monday.com, Asana) for ticket tracking
- Spawns AI coding agents that work on tickets autonomously
- Manages branches, PRs, and code review workflows

## Key commands
- \`prlt new\` — Create a new headquarters
- \`prlt linear connect\` / \`prlt asana connect\` / \`prlt monday connect\` / \`prlt trello configure\` — Connect a cloud PMO provider
- \`prlt repo add <path-or-url>\` — Add a repository to the HQ
- \`prlt ticket create\` — Create a new ticket
- \`prlt work start <ticket-id>\` — Spawn an agent to work on a ticket
- \`prlt ticket list\` — List tickets on the board

## Step-by-step setup guide

Guide the user through these steps IN ORDER. After each step, verify it succeeded before moving on.

### Step 1: Create the headquarters
Run:
\`\`\`bash
prlt new --json --name <project-name>
\`\`\`
Choose a name that represents the user's project or company. The HQ will be created at \`./<name>-hq/\`.

After the HQ is created, **\`cd\` into the new directory** so subsequent commands run in context:
\`\`\`bash
cd <name>-hq
\`\`\`

### Step 2: Connect a cloud PMO provider (REQUIRED)
The user MUST connect one of these cloud project management tools. This is not optional — prlt requires a cloud PMO for its core workflow.

Supported providers and how to get API keys:
${providerDocs}

Ask the user which provider they use, then help them connect it. If they don't have an API key yet, walk them through creating one.

### Step 3: Add a repository
Add at least one repository for agents to work on:
\`\`\`bash
prlt repo add <path-to-repo-or-git-url>
\`\`\`
This can be a local path to a git repository or a GitHub URL to clone.

### Step 4: Create a ticket (optional but recommended)
Create a sample ticket to see the workflow:
\`\`\`bash
prlt ticket create --title "My first ticket" --description "Test ticket for onboarding"
\`\`\`

### Step 5: Spawn an agent (optional but recommended)
Start an agent on the ticket:
\`\`\`bash
prlt work start <ticket-id>
\`\`\`
This creates a dedicated workspace and launches an agent to work on the ticket.

## Error recovery
- If \`prlt new\` fails with "inside a git repository": navigate to a parent directory outside any git repo
- If \`prlt new\` fails with "already exists": choose a different name or remove the existing directory
- If a provider connection fails with an auth error: double-check the API key and try again
- If \`prlt repo add\` fails: verify the path exists and is a valid git repository
- If any command fails unexpectedly: check \`prlt --help\` or the specific command's help with \`prlt <command> --help\`

## Important notes
- Always \`cd\` into the HQ directory after creating it — all subsequent commands need to run from within the HQ
- The PMO connection step is REQUIRED — do not skip it
- Keep the onboarding conversational and helpful — explain what each step does and why`;
}

/**
 * Spawn an AI tool to handle the setup automatically.
 * Runs interactively so the user can see and interact with the AI.
 */
function spawnAISetup(tool: DetectedTool, detection: ToolDetectionResult): Promise<boolean> {
  const prompt = buildSetupPrompt(detection);
  return new Promise((resolve) => {
    console.log(chalk.blue(`\nLaunching ${tool.displayName} to set up your HQ...\n`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log('');

    const child = spawn(tool.command, ['--print', prompt], {
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
 * Prompt the user to select a cloud PMO provider during manual onboarding.
 * Returns the selected provider value.
 */
export async function promptForPMOProvider(): Promise<PMOProviderValue> {
  console.log(chalk.blue('\n📡 Connect a cloud project management tool'));
  console.log(chalk.gray('  Proletariat requires a cloud PMO to track tickets and coordinate agents.\n'));

  const choices = PMO_PROVIDERS.map(p => ({
    name: p.name,
    value: p.value,
  }));

  const { provider } = await inquirer.prompt([{
    type: 'list',
    name: 'provider',
    message: 'Which project management tool does your team use?',
    choices,
  }]);

  return provider as PMOProviderValue;
}

/**
 * Show PMO provider connection instructions and prompt the user to connect.
 */
export async function connectPMOProvider(provider: PMOProviderValue): Promise<boolean> {
  const providerInfo = PMO_PROVIDERS.find(p => p.value === provider)!;

  console.log('');
  console.log(chalk.cyan(`Setting up ${providerInfo.name}:`));
  console.log(chalk.gray(`  ${providerInfo.apiKeyInstructions}`));
  console.log('');
  console.log(chalk.yellow(`  Run: ${providerInfo.connectCommand}`));
  console.log('');

  const { ready } = await inquirer.prompt([{
    type: 'list',
    name: 'ready',
    message: `Do you have your ${providerInfo.name} API key ready?`,
    choices: [
      { name: 'Yes, connect now', value: 'now' },
      { name: 'I\'ll connect later (skip for now)', value: 'later' },
    ],
  }]);

  if (ready === 'later') {
    console.log(chalk.yellow(`\n  You can connect later by running: ${providerInfo.connectCommand}\n`));
    return false;
  }

  // Spawn the connect command interactively
  return new Promise((resolve) => {
    const [cmd, ...args] = providerInfo.connectCommand.split(' ');
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green(`\n  ${providerInfo.name} connected successfully!\n`));
        resolve(true);
      } else {
        console.log(chalk.yellow(`\n  ${providerInfo.name} connection did not complete.`));
        console.log(chalk.yellow(`  You can retry later with: ${providerInfo.connectCommand}\n`));
        resolve(false);
      }
    });

    child.on('error', () => {
      console.log(chalk.red(`\n  Failed to launch ${providerInfo.connectCommand}`));
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
 * Outputs tool detection results, setup prompt, and choices as JSON.
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
        apiKeyInstructions: p.apiKeyInstructions,
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
