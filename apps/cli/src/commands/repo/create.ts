import { Flags } from '@oclif/core';
import { execSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { colors, format } from '../../lib/colors.js';
import { findHQRoot, isInGitRepo } from '../../lib/repos/index.js';
import { hasGitHubRemote } from '../../lib/repos/git.js';
import {
  isGHInstalled,
  isGHAuthenticated,
  getGHUsername,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
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

export default class Create extends PromptCommand {
  static description = 'Create a GitHub repository and set up remote';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --name my-repo --visibility private',
    '<%= config.bin %> <%= command.id %> --name my-repo --org my-company',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...machineOutputFlags,
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

  async run(): Promise<void> {
    const { flags } = await this.parse(Create);

    const jsonMode = shouldOutputJson(flags);
    const metadata = createMetadata('repo create', flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, metadata);
        return
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

    // Prompt for repo name
    const nameMessage = 'Repository name:';
    if (jsonMode) {
      if (!flags.name) {
        outputPromptAsJson(
          buildPromptConfig('input', 'repoName', nameMessage, undefined, repoName),
          metadata
        );
        return;
      }
    } else {
      const nameResult = await this.prompt<{ repoName: string }>([{
        type: 'input',
        name: 'repoName',
        message: nameMessage,
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
    }

    // Prompt for visibility
    const visibilityChoices = [
      { name: 'Private', value: 'private' },
      { name: 'Public', value: 'public' },
    ];
    const visibilityMessage = 'Repository visibility:';
    if (jsonMode) {
      if (!flags.visibility) {
        outputPromptAsJson(
          buildPromptConfig('list', 'visibility', visibilityMessage, visibilityChoices, visibility),
          metadata
        );
        return;
      }
    } else {
      const visibilityResult = await this.prompt<{ visibility: 'public' | 'private' }>([{
        type: 'list',
        name: 'visibility',
        message: visibilityMessage,
        choices: visibilityChoices,
        default: visibility,
      }], null);
      visibility = visibilityResult.visibility;
    }

    // Prompt for org if orgs are available
    const orgs = getGHOrganizations();
    const username = getGHUsername();

    if (orgs.length > 0 && !flags.org) {
      const ownerChoices = [
        { name: `${username || 'Personal'} (personal account)`, value: '' },
        ...orgs.map(o => ({ name: o, value: o })),
      ];
      const orgMessage = 'Create repository under:';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'org', orgMessage, ownerChoices),
          metadata
        );
        return;
      }

      const orgResult = await this.prompt<{ org: string }>([{
        type: 'list',
        name: 'org',
        message: orgMessage,
        choices: ownerChoices,
      }], null);
      org = orgResult.org || undefined;
    }

    // Confirm creation (interactive only)
    if (!jsonMode) {
      this.log('');
      this.log(colors.primary('Creating GitHub repository:'));
      this.log(`  Name: ${org ? `${org}/${repoName}` : repoName}`);
      this.log(`  Visibility: ${visibility}`);
      this.log(`  Push initial commit: ${flags.push ? 'Yes' : 'No'}`);
      this.log('');

      const confirmChoices = [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ];

      const confirmResult = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'Proceed with creation?',
        choices: confirmChoices,
      }], null);

      if (!confirmResult.confirm) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    // Create the repository
    if (!jsonMode) {
      this.log(colors.primary('Creating GitHub repository...'));
    }

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
        // Use the actual local folder name for the DB path, not repoName
        // (repoName may differ if user overrides it via --name)
        const localFolderName = path.basename(process.cwd());
        addRepositoriesToDatabase(hqPath, [{
          name: repoName,
          path: `repos/${localFolderName}`,
          source_url: result.url,
        }]);
        if (!jsonMode) {
          this.log(colors.textMuted('Updated prlt workspace database.'));
        }
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
      }, metadata);
      return;
    }

    this.log('');
    this.log(format.success(`Repository created: ${result.url}`));
    this.log('');
    this.log(colors.textMuted('Your local repository is now connected to GitHub.'));
    this.log(colors.textMuted('You can push changes with: git push'));
  }
}
