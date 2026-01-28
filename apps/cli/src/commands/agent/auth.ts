import { Command, Flags } from '@oclif/core';
import { execSync, spawnSync } from 'node:child_process';
import { colors } from '../../lib/colors.js';
import { isDockerRunning } from '../../lib/execution/runners.js';

const CLAUDE_CREDENTIALS_VOLUME = 'claude-credentials';

export default class Auth extends Command {
  static description = 'Set up Claude Code authentication for Docker containers (one-time setup)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
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
  };

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
   * Check if valid credentials exist in the volume
   */
  private credentialsExist(): boolean {
    try {
      const result = execSync(
        `docker run --rm -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
        { stdio: 'pipe', encoding: 'utf-8' }
      );

      // Parse and validate the credentials
      const creds = JSON.parse(result);
      if (creds.claudeAiOauth?.accessToken && creds.claudeAiOauth?.expiresAt) {
        // Check if expired
        const expiresAt = creds.claudeAiOauth.expiresAt;
        if (expiresAt > Date.now()) {
          return true;
        }
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
    this.log(colors.text('When prompted, type: /login'));
    this.log(colors.text('Then complete the browser authentication.'));
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
          'npm install -g @anthropic-ai/claude-code@latest --silent 2>/dev/null && chown -R node:node /home/node/.claude && echo "" && echo "Type: /login" && echo "" && su -s /bin/bash -c "HOME=/home/node CLAUDE_CONFIG_DIR=/home/node/.claude claude" node'
        ],
        { stdio: 'inherit' }
      );

      return result.status === 0;
    } catch (error) {
      this.log(colors.error(`Login flow failed: ${error}`));
      return false;
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);

    // Check Docker is running
    if (!isDockerRunning()) {
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    // Ensure volume exists
    if (!this.volumeExists()) {
      this.log(colors.textSecondary(`Creating Docker volume: ${CLAUDE_CREDENTIALS_VOLUME}`));
      this.createVolume();
    }

    // Check for existing credentials
    const hasCredentials = this.credentialsExist();

    if (flags.check) {
      // Just report status
      if (hasCredentials) {
        const info = this.getCredentialInfo();
        this.log(colors.success('✓ Claude Code credentials are configured'));
        if (info) {
          this.log(colors.textSecondary(`  Subscription: ${info.subscriptionType || 'unknown'}`));
          this.log(colors.textSecondary(`  Expires: ${info.expiresAt.toLocaleDateString()}`));
        }
      } else {
        this.log(colors.warning('✗ No Claude Code credentials found'));
        this.log(colors.textSecondary('  Run "prlt agent auth" to authenticate'));
        this.exit(1);
      }
      return;
    }

    if (hasCredentials && !flags.force) {
      const info = this.getCredentialInfo();
      this.log(colors.success('✓ Claude Code credentials already configured'));
      if (info) {
        this.log(colors.textSecondary(`  Subscription: ${info.subscriptionType || 'unknown'}`));
        this.log(colors.textSecondary(`  Expires: ${info.expiresAt.toLocaleDateString()}`));
      }
      this.log('');
      this.log(colors.text('Use --force to re-authenticate.'));
      return;
    }

    // Run the login flow
    const success = this.runLoginFlow();

    if (success && this.credentialsExist()) {
      this.log('');
      this.log(colors.success('✓ Authentication successful!'));
      this.log(colors.textSecondary('  Credentials saved to Docker volume: ' + CLAUDE_CREDENTIALS_VOLUME));
      this.log(colors.textSecondary('  All agent containers will share these credentials.'));
    } else {
      this.log('');
      this.log(colors.warning('Authentication may not have completed.'));
      this.log(colors.textSecondary('Run "prlt agent auth --check" to verify.'));
    }
  }
}
