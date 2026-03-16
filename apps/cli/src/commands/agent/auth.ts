import { Flags } from '@oclif/core';
import { execSync, spawnSync } from 'node:child_process';
import { PromptCommand } from '../../lib/prompt-command.js';
import { colors } from '../../lib/colors.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { isDockerRunning } from '../../lib/execution/runners.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { findHQRoot } from '../../lib/workspace.js';
import { getWorkspaceDbPath } from '../../lib/workspace.js';
import { saveAuthMethod } from '../../lib/execution/config.js';
import Database from 'better-sqlite3';

const CLAUDE_CREDENTIALS_VOLUME = 'claude-credentials';

export default class Auth extends PromptCommand {
  static description = 'Set up Claude Code authentication for Docker containers (one-time setup)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --api-key',
  ];

  static flags = {
    check: Flags.boolean({
      description: 'Only check if credentials exist (do not prompt for login)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    'api-key': Flags.boolean({
      description: 'Use ANTHROPIC_API_KEY instead of OAuth (saves preference)',
      default: false,
    }),
    ...machineOutputFlags,
  };

  /**
   * Try to open the workspace database for saving auth preferences.
   * Returns null if not in an HQ directory (auth still works, just won't save preference).
   */
  private tryOpenDb(): Database.Database | null {
    try {
      const hqPath = findHQRoot();
      if (!hqPath) return null;
      const dbPath = getWorkspaceDbPath(hqPath);
      const db = new Database(dbPath);
      db.pragma('foreign_keys = ON');
      return db;
    } catch {
      return null;
    }
  }

  /**
   * Check if the claude-credentials volume exists
   */
  private volumeExists(): boolean {
    try {
      execSync(`docker volume inspect ${CLAUDE_CREDENTIALS_VOLUME}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create the claude-credentials volume if it doesn't exist
   */
  private createVolume(): void {
    try {
      execSync(`docker volume create ${CLAUDE_CREDENTIALS_VOLUME}`, { stdio: 'pipe' });
    } catch (error) {
      this.error(`Failed to create Docker volume: ${error}`);
    }
  }

  /**
   * Check if valid credentials exist in the volume.
   * Don't check expiration - access tokens are short-lived but Claude Code
   * handles token refresh internally using stored refresh tokens.
   */
  private credentialsExist(): boolean {
    try {
      const result = execSync(
        `docker run --rm -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
        { stdio: 'pipe', encoding: 'utf-8' }
      );

      const creds = JSON.parse(result);
      if (creds.claudeAiOauth?.accessToken) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get credential info for display
   */
  private getCredentialInfo(): { expiresAt: Date; subscriptionType?: string } | null {
    try {
      const result = execSync(
        `docker run --rm -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
        { stdio: 'pipe', encoding: 'utf-8' }
      );

      const creds = JSON.parse(result);
      if (creds.claudeAiOauth?.expiresAt) {
        return {
          expiresAt: new Date(creds.claudeAiOauth.expiresAt),
          subscriptionType: creds.claudeAiOauth.subscriptionType,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Run the interactive login flow in a temporary container
   */
  private runLoginFlow(): boolean {
    this.log(colors.primary('🔐 Starting Claude Code authentication...'));
    this.log('');
    this.log(colors.text('A temporary container will start with Claude Code.'));
    this.log(colors.text('Complete the browser authentication when prompted.'));
    this.log('');
    this.log(colors.textSecondary('Press Ctrl+C to cancel.'));
    this.log('');

    try {
      // Run interactive container with the volume mounted
      const result = spawnSync(
        'docker',
        [
          'run',
          '-it',
          '--rm',
          '-v', `${CLAUDE_CREDENTIALS_VOLUME}:/home/node/.claude`,
          'node:20',
          'bash', '-c',
          // Install as root, then run claude as node user (so credentials have correct ownership)
          // Pass "/login" as initial prompt so user doesn't have to type it manually
          'npm install -g @anthropic-ai/claude-code@latest --silent 2>/dev/null && chown -R node:node /home/node/.claude && su -s /bin/bash -c "HOME=/home/node CLAUDE_CONFIG_DIR=/home/node/.claude claude \\"/login\\"" node'
        ],
        { stdio: 'inherit' }
      );

      return result.status === 0;
    } catch (error) {
      this.log(colors.error(`Login flow failed: ${error}`));
      return false;
    }
  }

  /**
   * Handle API key authentication flow
   */
  private handleApiKey(jsonMode: boolean, flags: Record<string, unknown>): void {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson('API_KEY_NOT_SET', 'ANTHROPIC_API_KEY is not set in your environment. Export it and try again.', createMetadata('agent auth', flags));
        return
      }
      this.error('ANTHROPIC_API_KEY is not set in your environment.\nExport it with: export ANTHROPIC_API_KEY=sk-ant-...');
    }

    // Save preference to config if in an HQ
    const db = this.tryOpenDb();
    if (db) {
      try {
        saveAuthMethod(db, 'apikey');
      } finally {
        db.close();
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        authenticated: true,
        method: 'apikey',
        message: 'ANTHROPIC_API_KEY is set. Auth method saved as default.',
      }, createMetadata('agent auth', flags));
      return;
    }

    this.log(colors.success('✓ ANTHROPIC_API_KEY is set'));
    this.log(colors.textSecondary('  Auth method saved as default: apikey'));
    this.log(colors.textSecondary('  Containers will use your API key for authentication.'));
    this.log('');
    this.log(colors.warning('  Note: This uses API credits, not your Max subscription.'));
    this.log(colors.textSecondary(`  Run "${this.config.bin} agent auth" (without --api-key) to switch to OAuth.`));
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);
    const jsonModeConfig = jsonMode ? { flags, commandName: 'agent auth' } : null;

    // Handle --api-key shortcut: validate key and save preference
    if (flags['api-key']) {
      this.handleApiKey(jsonMode, flags);
      return;
    }

    // Check Docker is running (needed for OAuth flow)
    if (!isDockerRunning()) {
      // If Docker isn't running, offer API key as alternative
      const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

      if (hasApiKey && !flags.check) {
        this.log(colors.warning('Docker is not running.'));
        this.log('');

        const { authChoice } = await this.prompt<{ authChoice: string }>([{
          type: 'list',
          name: 'authChoice',
          message: 'Docker is required for OAuth. Use API key instead?',
          choices: [
            { name: 'Use ANTHROPIC_API_KEY instead (API credits)', value: 'apikey', command: `${this.config.bin} agent auth --api-key --json` },
            { name: 'Cancel (start Docker first for OAuth)', value: 'cancel' },
          ],
          default: 'apikey',
        }], jsonModeConfig);

        if (authChoice === 'apikey') {
          this.handleApiKey(jsonMode, flags);
          return;
        }
      }

      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running. Please start Docker Desktop and try again.', createMetadata('agent auth', flags));
        return
      }
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    // Ensure volume exists
    if (!this.volumeExists()) {
      if (!jsonMode) {
        this.log(colors.textSecondary(`Creating Docker volume: ${CLAUDE_CREDENTIALS_VOLUME}`));
      }
      this.createVolume();
    }

    // Check for existing credentials
    const hasCredentials = this.credentialsExist();
    const info = hasCredentials ? this.getCredentialInfo() : null;

    if (flags.check) {
      // Just report status
      if (hasCredentials) {
        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            method: 'oauth',
            subscriptionType: info?.subscriptionType || 'unknown',
            expiresAt: info?.expiresAt.toISOString(),
          }, createMetadata('agent auth', flags));
          return;
        }
        this.log(colors.success('✓ Claude Code credentials are configured'));
        if (info) {
          this.log(colors.textSecondary(`  Subscription: ${info.subscriptionType || 'unknown'}`));
          this.log(colors.textSecondary(`  Expires: ${info.expiresAt.toLocaleDateString()}`));
        }
      } else {
        if (jsonMode) {
          outputErrorAsJson('NO_CREDENTIALS', 'No Claude Code credentials found. Run "prlt agent auth" to authenticate.', createMetadata('agent auth', flags));
          return
        }
        this.log(colors.warning('✗ No Claude Code credentials found'));
        this.log(colors.textSecondary('  Run "prlt agent auth" to authenticate'));
        this.exit(1);
      }
      return;
    }

    if (hasCredentials && !flags.force) {
      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          method: 'oauth',
          subscriptionType: info?.subscriptionType || 'unknown',
          expiresAt: info?.expiresAt.toISOString(),
          message: 'Credentials already configured. Use --force to re-authenticate.',
        }, createMetadata('agent auth', flags));
        return;
      }
      this.log(colors.success('✓ Claude Code credentials already configured'));
      if (info) {
        this.log(colors.textSecondary(`  Subscription: ${info.subscriptionType || 'unknown'}`));
        this.log(colors.textSecondary(`  Expires: ${info.expiresAt.toLocaleDateString()}`));
      }
      this.log('');
      this.log(colors.text('Use --force to re-authenticate.'));
      return;
    }

    // Prompt for auth method choice (OAuth or API key)
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    // Only prompt if there's a real choice (API key is available)
    let selectedMethod = 'oauth';
    if (hasApiKey) {
      const { selectedMethod: chosen } = await this.prompt<{ selectedMethod: string }>([{
        type: 'list',
        name: 'selectedMethod',
        message: 'Which authentication method would you like to use?',
        choices: [
          { name: 'OAuth (recommended — uses Max subscription)', value: 'oauth', command: `${this.config.bin} agent auth --force --json` },
          { name: 'API key (uses API credits, not Max subscription)', value: 'apikey', command: `${this.config.bin} agent auth --api-key --json` },
        ],
        default: 'oauth',
      }], jsonModeConfig);
      selectedMethod = chosen;
    }

    if (selectedMethod === 'apikey') {
      this.handleApiKey(jsonMode, flags);
      return;
    }

    // JSON mode cannot handle interactive login flow
    if (jsonMode) {
      outputErrorAsJson('INTERACTIVE_REQUIRED', 'Authentication requires interactive login. Run without --json flag to authenticate.', createMetadata('agent auth', flags));
      return
    }

    // Run the OAuth login flow
    const success = this.runLoginFlow();

    if (success && this.credentialsExist()) {
      // Save OAuth as auth method preference
      const db = this.tryOpenDb();
      if (db) {
        try {
          saveAuthMethod(db, 'oauth');
        } finally {
          db.close();
        }
      }

      this.log('');
      this.log(colors.success('✓ Authentication successful!'));
      this.log(colors.textSecondary('  Credentials saved to Docker volume: ' + CLAUDE_CREDENTIALS_VOLUME));
      this.log(colors.textSecondary('  All agent containers will share these credentials.'));
      this.log(colors.textSecondary('  Auth method saved as default: oauth'));
    } else {
      this.log('');
      this.log(colors.warning('Authentication may not have completed.'));
      this.log(colors.textSecondary('Run "prlt agent auth --check" to verify.'));
    }
  }
}
