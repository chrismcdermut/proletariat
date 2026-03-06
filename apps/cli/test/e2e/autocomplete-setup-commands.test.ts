import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  extractJson,
  execInProcess,
} from './test-helpers.js';

/**
 * Response type for JSON prompt output from --machine flag
 */
interface MachinePromptResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices?: Array<{
      name: string;
      value: string;
      command?: string;
    }>;
    default?: string;
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
    timestamp?: string;
  };
}

/**
 * Response type for success JSON output
 */
interface MachineSuccessResponse {
  prompt: null;
  success: true;
  result: Record<string, unknown>;
  metadata: {
    command: string;
    flags: Record<string, unknown>;
    timestamp?: string;
  };
}

/**
 * E2E tests for autocomplete setup commands with JSON/machine mode support.
 *
 * Tests verify:
 * - JSON mode outputs valid prompt schema with shell choices
 * - Legacy --json flag works
 * - -m shorthand works
 * - --shell flag bypasses prompt and returns success JSON
 * - --shell --install actually creates config files
 * - End-to-end agent navigation flow
 */
describe('Autocomplete Setup Commands E2E - Agent Flow (--machine)', function (this: Mocha.Suite) {
  this.timeout(30000);

  let testDir: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let fakeHome: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'autocomplete-setup-')));
    process.chdir(testDir);

    // Create a fake home directory to prevent touching real shell config
    fakeHome = path.join(testDir, 'fakehome');
    fs.mkdirSync(fakeHome, { recursive: true });

    // Set HOME to fakeHome so autocomplete install writes there
    process.env.HOME = fakeHome;

    // Create .proletariat dir and minimal config for oclif
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    fs.writeFileSync(path.join(proletariatDir, 'config.json'), JSON.stringify({
      type: 'hq',
      name: 'test-hq',
      hasPmo: false,
    }), 'utf-8');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Execute an autocomplete command in-process with the fake HOME set.
   */
  async function execAutocomplete(cmd: string): Promise<string> {
    return execInProcess(cmd);
  }

  // ===========================================================================
  // autocomplete setup --machine (shell selection prompt)
  // ===========================================================================

  describe('autocomplete setup --machine (shell selection)', () => {
    it('should output valid JSON prompt with --machine flag', async () => {
      const output = await execAutocomplete('autocomplete setup --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('shell');
      expect(json!.prompt.message).to.include('shell');
      expect(json!.prompt.choices).to.be.an('array');
      expect(json!.metadata.command).to.equal('autocomplete setup');
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should output valid JSON with --json flag (legacy)', async () => {
      const output = await execAutocomplete('autocomplete setup --json');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('shell');
      expect(json!.metadata.flags.json).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await execAutocomplete('autocomplete setup -m');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should include all three shell choices', async () => {
      const output = await execAutocomplete('autocomplete setup --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      const values = json!.prompt.choices!.map(c => c.value);
      expect(values).to.include('zsh');
      expect(values).to.include('bash');
      expect(values).to.include('powershell');
    });

    it('should include --machine flag in choice commands', async () => {
      const output = await execAutocomplete('autocomplete setup --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices || []) {
        if (choice.command) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('--shell');
          expect(choice.command).to.include('--install');
        }
      }
    });

    it('should have proper command format for each shell choice', async () => {
      const output = await execAutocomplete('autocomplete setup --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices || []) {
        expect(choice.command).to.match(
          /^prlt autocomplete setup --shell (zsh|bash|powershell) --install --machine$/
        );
      }
    });
  });

  // ===========================================================================
  // autocomplete setup --shell <shell> --machine (success output)
  // ===========================================================================

  describe('autocomplete setup --shell <shell> --machine (success output)', () => {
    it('should output success JSON with config info for zsh', async () => {
      const output = await execAutocomplete('autocomplete setup --shell zsh --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.prompt).to.be.null;
      expect(json!.result.shell).to.equal('zsh');
      expect(json!.result.configFile).to.be.a('string');
      expect(json!.result.snippet).to.include('autocomplete:script zsh');
      expect(json!.result.installed).to.equal(false);
      expect(json!.result.installCommand).to.include('--shell zsh --install');
    });

    it('should output success JSON with config info for bash', async () => {
      const output = await execAutocomplete('autocomplete setup --shell bash --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.result.shell).to.equal('bash');
      expect(json!.result.snippet).to.include('autocomplete:script bash');
    });

    it('should output success JSON with config info for powershell', async () => {
      const output = await execAutocomplete('autocomplete setup --shell powershell --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.result.shell).to.equal('powershell');
      expect(json!.result.snippet).to.include('powershell');
    });

    it('should include metadata with command and flags', async () => {
      const output = await execAutocomplete('autocomplete setup --shell zsh --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata.command).to.equal('autocomplete setup');
      expect(json!.metadata.flags.machine).to.equal(true);
      expect(json!.metadata.flags.shell).to.equal('zsh');
    });
  });

  // ===========================================================================
  // autocomplete setup --shell <shell> --install --machine (install flow)
  // ===========================================================================

  describe('autocomplete setup --shell <shell> --install --machine (install flow)', () => {
    it('should install zsh autocomplete and output success JSON', async () => {
      const output = await execAutocomplete('autocomplete setup --shell zsh --install --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.result.shell).to.equal('zsh');
      expect(json!.result.installed).to.equal(true);
      expect(json!.result.alreadyConfigured).to.equal(false);

      // Verify the config file was actually created
      const zshrcPath = path.join(fakeHome, '.zshrc');
      expect(fs.existsSync(zshrcPath)).to.equal(true);
      const content = fs.readFileSync(zshrcPath, 'utf-8');
      expect(content).to.include('prlt autocomplete');
      expect(content).to.include('autocomplete:script zsh');
    });

    it('should install bash autocomplete and output success JSON', async () => {
      const output = await execAutocomplete('autocomplete setup --shell bash --install --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.result.shell).to.equal('bash');
      expect(json!.result.installed).to.equal(true);

      // Verify the config file was actually created
      // On macOS, bash uses .bash_profile; on Linux, .bashrc
      const bashConfigFile = process.platform === 'darwin'
        ? path.join(fakeHome, '.bash_profile')
        : path.join(fakeHome, '.bashrc');
      expect(fs.existsSync(bashConfigFile)).to.equal(true);
      const content = fs.readFileSync(bashConfigFile, 'utf-8');
      expect(content).to.include('prlt autocomplete');
    });

    it('should detect already-configured and not duplicate', async () => {
      // First install
      await execAutocomplete('autocomplete setup --shell zsh --install --machine');

      // Second install - should detect already configured
      const output = await execAutocomplete('autocomplete setup --shell zsh --install --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.result.installed).to.equal(false);
      expect(json!.result.alreadyConfigured).to.equal(true);

      // Verify only one autocomplete block in config file
      const zshrcPath = path.join(fakeHome, '.zshrc');
      const content = fs.readFileSync(zshrcPath, 'utf-8');
      // "prlt autocomplete" appears once in the snippet line
      const matches = content.match(/prlt autocomplete/g);
      expect(matches).to.have.lengthOf(1);
    });

    it('should create config directory if it does not exist', async () => {
      const output = await execAutocomplete('autocomplete setup --shell powershell --install --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.result.installed).to.equal(true);

      // PowerShell profile is in a nested directory
      const configFile = json!.result.configFile as string;
      expect(fs.existsSync(configFile)).to.equal(true);
    });
  });

  // ===========================================================================
  // Non-machine mode with --shell (piped output enters JSON mode via isNonTTY)
  // ===========================================================================

  describe('Non-machine mode with --shell flag (piped output)', () => {
    // Note: In piped/test environments, isNonTTY() returns true, so the command
    // automatically enters JSON mode even without --machine flag. This is correct
    // behavior - it ensures agents get structured output when piping.

    it('should output JSON for zsh config info without --machine flag', async () => {
      const output = await execAutocomplete('autocomplete setup --shell zsh');
      const json = extractJson<MachineSuccessResponse>(output);

      // In piped mode, isNonTTY() triggers JSON output
      expect(json).to.not.be.null;
      expect(json!.result.shell).to.equal('zsh');
      expect(json!.result.snippet).to.include('autocomplete:script zsh');
    });

    it('should install for zsh with --shell and --install flags', async () => {
      await execAutocomplete('autocomplete setup --shell zsh --install');

      // Verify it installed (check config file)
      const zshrcPath = path.join(fakeHome, '.zshrc');
      expect(fs.existsSync(zshrcPath)).to.equal(true);
      const content = fs.readFileSync(zshrcPath, 'utf-8');
      expect(content).to.include('prlt autocomplete');
    });

    it('should output JSON for bash config info without --machine flag', async () => {
      const output = await execAutocomplete('autocomplete setup --shell bash');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.result.shell).to.equal('bash');
      expect(json!.result.snippet).to.include('autocomplete:script bash');
    });

    it('should detect already-configured when installing twice', async () => {
      // First install
      await execAutocomplete('autocomplete setup --shell zsh --install');

      // Second install - should detect already configured
      const output = await execAutocomplete('autocomplete setup --shell zsh --install');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.result.installed).to.equal(false);
      expect(json!.result.alreadyConfigured).to.equal(true);
    });
  });

  // ===========================================================================
  // End-to-end agent flows
  // ===========================================================================

  describe('End-to-end agent flows', () => {
    it('should complete full agent flow: get shell menu → select shell → install → verify', async () => {
      // Step 1: Agent calls autocomplete setup with --machine
      const menuOutput = await execAutocomplete('autocomplete setup --machine');
      const menu = extractJson<MachinePromptResponse>(menuOutput);

      expect(menu).to.not.be.null;
      expect(menu!.prompt.type).to.equal('list');
      expect(menu!.prompt.name).to.equal('shell');

      // Step 2: Agent finds the bash choice
      const bashChoice = menu!.prompt.choices!.find(c => c.value === 'bash');
      expect(bashChoice).to.exist;
      expect(bashChoice!.command).to.include('--shell bash');
      expect(bashChoice!.command).to.include('--install');
      expect(bashChoice!.command).to.include('--machine');

      // Step 3: Agent executes the command from the choice
      const installCmd = bashChoice!.command!.replace('prlt ', '');
      const installOutput = await execAutocomplete(installCmd);
      const installResult = extractJson<MachineSuccessResponse>(installOutput);

      // Step 4: Verify install succeeded
      expect(installResult).to.not.be.null;
      expect(installResult!.success).to.equal(true);
      expect(installResult!.result.shell).to.equal('bash');
      expect(installResult!.result.installed).to.equal(true);

      // Step 5: Verify the actual config file exists on disk
      // On macOS, bash uses .bash_profile; on Linux, .bashrc
      const bashConfigFile = process.platform === 'darwin'
        ? path.join(fakeHome, '.bash_profile')
        : path.join(fakeHome, '.bashrc');
      expect(fs.existsSync(bashConfigFile)).to.equal(true);
      const content = fs.readFileSync(bashConfigFile, 'utf-8');
      expect(content).to.include('prlt autocomplete');
      expect(content).to.include('autocomplete:script bash');
    });

    it('should complete flow for zsh: menu → install → verify file', async () => {
      // Step 1: Get menu
      const menuOutput = await execAutocomplete('autocomplete setup --machine');
      const menu = extractJson<MachinePromptResponse>(menuOutput);
      expect(menu).to.not.be.null;

      // Step 2: Find zsh choice
      const zshChoice = menu!.prompt.choices!.find(c => c.value === 'zsh');
      expect(zshChoice).to.exist;

      // Step 3: Execute install command
      const installCmd = zshChoice!.command!.replace('prlt ', '');
      const installOutput = await execAutocomplete(installCmd);
      const result = extractJson<MachineSuccessResponse>(installOutput);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(true);
      expect(result!.result.installed).to.equal(true);

      // Step 4: Verify file
      const zshrcPath = path.join(fakeHome, '.zshrc');
      expect(fs.existsSync(zshrcPath)).to.equal(true);
      expect(fs.readFileSync(zshrcPath, 'utf-8')).to.include('autocomplete:script zsh');
    });

    it('should complete flow for powershell: menu → install → verify file', async () => {
      // Step 1: Get menu
      const menuOutput = await execAutocomplete('autocomplete setup --machine');
      const menu = extractJson<MachinePromptResponse>(menuOutput);
      expect(menu).to.not.be.null;

      // Step 2: Find powershell choice
      const psChoice = menu!.prompt.choices!.find(c => c.value === 'powershell');
      expect(psChoice).to.exist;
      expect(psChoice!.command).to.include('--shell powershell');

      // Step 3: Execute install command from the choice
      const installCmd = psChoice!.command!.replace('prlt ', '');
      const installOutput = await execAutocomplete(installCmd);
      const result = extractJson<MachineSuccessResponse>(installOutput);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(true);
      expect(result!.result.shell).to.equal('powershell');
      expect(result!.result.installed).to.equal(true);

      // Step 4: Verify file was created with correct content
      const configFile = result!.result.configFile as string;
      expect(fs.existsSync(configFile)).to.equal(true);
      const content = fs.readFileSync(configFile, 'utf-8');
      expect(content).to.include('prlt autocomplete');
      expect(content).to.include('powershell');
    });

    it('should handle info flow: menu → shell info without install', async () => {
      // Step 1: Get the menu
      const menuOutput = await execAutocomplete('autocomplete setup --machine');
      const menu = extractJson<MachinePromptResponse>(menuOutput);
      expect(menu).to.not.be.null;

      // Step 2: Agent queries shell info without --install
      const infoOutput = await execAutocomplete('autocomplete setup --shell zsh --machine');
      const info = extractJson<MachineSuccessResponse>(infoOutput);

      expect(info).to.not.be.null;
      expect(info!.success).to.equal(true);
      expect(info!.result.shell).to.equal('zsh');
      expect(info!.result.installed).to.equal(false);
      expect(info!.result.snippet).to.include('autocomplete:script zsh');
      expect(info!.result.installCommand).to.include('--shell zsh --install');

      // Verify no file was created (no install was performed)
      const zshrcPath = path.join(fakeHome, '.zshrc');
      expect(fs.existsSync(zshrcPath)).to.equal(false);
    });
  });

  // ===========================================================================
  // Flag combinations and edge cases
  // ===========================================================================

  describe('Flag combinations and edge cases', () => {
    it('should handle --machine and --json together (--machine takes precedence)', async () => {
      const output = await execAutocomplete('autocomplete setup --machine --json');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should propagate --machine flag through choice commands', async () => {
      const output = await execAutocomplete('autocomplete setup --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices || []) {
        if (choice.command) {
          expect(choice.command, `Choice ${choice.name} should include --machine`)
            .to.include('--machine');
        }
      }
    });

    it('should include command field in every choice for agent navigation', async () => {
      const output = await execAutocomplete('autocomplete setup --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices || []) {
        expect(choice.command, `Choice "${choice.name}" should have a command field`)
          .to.be.a('string')
          .that.is.not.empty;
      }
    });

    it('should handle install to pre-existing config file', async () => {
      // Create a pre-existing .zshrc with some content
      const zshrcPath = path.join(fakeHome, '.zshrc');
      fs.writeFileSync(zshrcPath, '# My existing zsh config\nexport PATH="/usr/local/bin:$PATH"\n');

      // Install autocomplete
      const output = await execAutocomplete('autocomplete setup --shell zsh --install --machine');
      const json = extractJson<MachineSuccessResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.result.installed).to.equal(true);

      // Verify original content is preserved and autocomplete was appended
      const content = fs.readFileSync(zshrcPath, 'utf-8');
      expect(content).to.include('My existing zsh config');
      expect(content).to.include('prlt autocomplete');
    });
  });
});
