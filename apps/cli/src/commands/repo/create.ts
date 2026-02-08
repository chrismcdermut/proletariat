import { Flags } from '@oclif/core';
import { execSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot, isInGitRepo } from '../../lib/repos/index.js';
import {
  isGHInstalled,
  isGHAuthenticated,
  getGHUsername,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { addRepositoriesToDatabase } from '../../lib/database/index.js';

// =============================================================================
// Types
// =============================================================================

interface CreateRepoResult {
  success: boolean;
  url?: string;
  name?: string;
  error?: string;
}

// =============================================================================
// GitHub Helpers
// =============================================================================

/**
 * Check if the current directory has a GitHub remote configured.
 */
export function hasGitHubRemote(cwd?: string): boolean {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return remoteUrl.includes('github.com');
  } catch {
    return false;
  }
}

/**
 * Get the user's GitHub organizations.
 */
export function getGHOrganizations(): string[] {
  try {
    const result = execSync('gh api user/orgs --jq ".[].login"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result ? result.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Create a GitHub repository using `gh` CLI.
 */
export function createGHRepo(options: {
  name: string;
  visibility: 'public' | 'private';
  org?: string;
  cwd?: string;
  push?: boolean;
}): CreateRepoResult {
  const { name, visibility, org, cwd, push = true } = options;
  const repoName = org ? `${org}/${name}` : name;

  const args = [
    'repo', 'create', repoName,
    `--${visibility}`,
    '--source=.',
    '--remote=origin',
  ];

  if (push) {
    args.push('--push');
  }

  try {
    const result = spawnSync('gh', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to create repository',
      };
    }

    // Parse the repo URL from stdout
    const url = result.stdout.trim();

    return {
      success: true,
      url,
      name: repoName,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// Command
// =============================================================================

export default class Create extends PMOCommand {
  static description = 'Create a GitHub repository and set up remote';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --name my-repo --visibility private',
    '<%= config.bin %> <%= command.id %> --name my-repo --org my-company',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'Repository name (defaults to current directory name)',
    }),
    visibility: Flags.string({
      char: 'v',
      description: 'Repository visibility',
      options: ['public', 'private'],
      default: 'private',
    }),
    org: Flags.string({
      char: 'o',
      description: 'GitHub organization (creates personal repo if not specified)',
    }),
    push: Flags.boolean({
      description: 'Push initial commit after creating repo',
      default: true,
      allowNo: true,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Create);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('repo create', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Check prerequisites
    if (!isGHInstalled()) {
      return handleError(
        'GH_NOT_INSTALLED',
        'GitHub CLI (gh) is not installed. Install with: brew install gh'
      );
    }

    if (!isGHAuthenticated()) {
      return handleError(
        'GH_NOT_AUTHENTICATED',
        'Not authenticated with GitHub. Run: gh auth login'
      );
    }

    // Must be in a git repo
    if (!isInGitRepo()) {
      return handleError(
        'NOT_GIT_REPO',
        'Not in a git repository. Initialize one with: git init'
      );
    }

    // Check if remote already exists
    if (hasGitHubRemote()) {
      return handleError(
        'REMOTE_EXISTS',
        'This repository already has a GitHub remote configured.'
      );
    }

    // Gather parameters
    let repoName = flags.name;
    let visibility = flags.visibility as 'public' | 'private';
    let org = flags.org;

    // Get default repo name from directory
    if (!repoName) {
      repoName = path.basename(process.cwd());
    }

    // Interactive mode: prompt for missing values
    if (!jsonMode) {
      // Prompt for repo name
      const nameResult = await this.prompt<{ repoName: string }>([{
        type: 'input',
        name: 'repoName',
        message: 'Repository name:',
        default: repoName,
        validate: (input: unknown) => {
          const value = String(input || '');
          if (!value.trim()) return 'Repository name is required';
          if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
            return 'Repository name can only contain letters, numbers, dots, hyphens, and underscores';
          }
          return true;
        },
      }], null);
      repoName = nameResult.repoName;

      // Prompt for visibility
      const visibilityResult = await this.prompt<{ visibility: 'public' | 'private' }>([{
        type: 'list',
        name: 'visibility',
        message: 'Repository visibility:',
        choices: [
          { name: 'Private', value: 'private' },
          { name: 'Public', value: 'public' },
        ],
        default: visibility,
      }], null);
      visibility = visibilityResult.visibility;

      // Get user's orgs and prompt if available
      const orgs = getGHOrganizations();
      const username = getGHUsername();

      if (orgs.length > 0) {
        const ownerChoices = [
          { name: `${username} (personal account)`, value: '' },
          ...orgs.map(o => ({ name: o, value: o })),
        ];

        const orgResult = await this.prompt<{ org: string }>([{
          type: 'list',
          name: 'org',
          message: 'Create repository under:',
          choices: ownerChoices,
        }], null);
        org = orgResult.org || undefined;
      }

      // Confirm creation
      this.log('');
      this.log(colors.primary('Creating GitHub repository:'));
      this.log(`  Name: ${org ? `${org}/${repoName}` : repoName}`);
      this.log(`  Visibility: ${visibility}`);
      this.log(`  Push initial commit: ${flags.push ? 'Yes' : 'No'}`);
      this.log('');

      const confirmResult = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'Proceed with creation?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      }], null);

      if (!confirmResult.confirm) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    // Create the repository
    this.log(colors.primary('Creating GitHub repository...'));

    const result = createGHRepo({
      name: repoName,
      visibility,
      org,
      push: flags.push,
    });

    if (!result.success) {
      return handleError('CREATE_FAILED', `Failed to create repository: ${result.error}`);
    }

    // Update prlt database if in HQ
    const hqPath = findHQRoot();
    if (hqPath) {
      try {
        addRepositoriesToDatabase(hqPath, [{
          name: repoName,
          path: `repos/${repoName}`,
          source_url: result.url,
        }]);
        this.log(colors.textMuted('Updated prlt workspace database.'));
      } catch {
        // Ignore database update errors - repo was still created
      }
    }

    // Success output
    if (jsonMode) {
      outputSuccessAsJson({
        created: true,
        name: result.name,
        url: result.url,
        visibility,
        org: org || null,
      }, createMetadata('repo create', flags));
      return;
    }

    this.log('');
    this.log(format.success(`Repository created: ${result.url}`));
    this.log('');
    this.log(colors.textMuted('Your local repository is now connected to GitHub.'));
    this.log(colors.textMuted('You can push changes with: git push'));
  }
}
