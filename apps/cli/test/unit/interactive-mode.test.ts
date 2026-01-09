import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Programmatic test to verify interactive mode pattern across all CLI commands
 *
 * Pattern: Commands that require flags should enter interactive mode when run
 * without flags, prompting the user for values rather than erroring.
 *
 * Spec: TKT-057
 */
describe('Interactive Mode Support Audit', () => {
  const commandsDir = path.resolve(__dirname, '../../src/commands');

  interface CommandInfo {
    path: string;
    relativePath: string;
    hasFlags: boolean;
    hasRequiredFlags: boolean;
    hasArgs: boolean;
    hasRequiredArgs: boolean;
    usesInquirer: boolean;
    hasInteractiveFlag: boolean;
    autoEntersInteractive: boolean;
    classification: 'GOOD' | 'NEEDS_FIX' | 'N/A' | 'MENU';
    issues: string[];
  }

  function analyzeCommandFile(filePath: string): CommandInfo {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(commandsDir, filePath);

    const info: CommandInfo = {
      path: filePath,
      relativePath,
      hasFlags: false,
      hasRequiredFlags: false,
      hasArgs: false,
      hasRequiredArgs: false,
      usesInquirer: false,
      hasInteractiveFlag: false,
      autoEntersInteractive: false,
      classification: 'N/A',
      issues: [],
    };

    // Check for imports
    info.usesInquirer = content.includes("import inquirer from 'inquirer'") ||
                        content.includes('from "inquirer"') ||
                        content.includes("require('inquirer')");

    // Check for static flags
    const flagsMatch = content.match(/static flags\s*=\s*\{[\s\S]*?\n\s*\}/);
    if (flagsMatch) {
      info.hasFlags = true;
      const flagsSection = flagsMatch[0];

      // Check for required flags
      info.hasRequiredFlags = flagsSection.includes('required: true');

      // Check for interactive flag
      info.hasInteractiveFlag = flagsSection.includes("interactive: Flags.boolean") ||
                                flagsSection.includes('interactive:');
    }

    // Check for static args
    const argsMatch = content.match(/static args\s*=\s*\{[\s\S]*?\n\s*\}/);
    if (argsMatch) {
      info.hasArgs = true;
      const argsSection = argsMatch[0];

      // Check for required args
      info.hasRequiredArgs = argsSection.includes('required: true');
    }

    // Check if it's a menu command (always interactive)
    const isMenuCommand = content.includes("type: 'list'") &&
                          content.includes('message:') &&
                          !info.hasFlags &&
                          (content.includes('action') || content.includes('What would you like'));

    if (isMenuCommand) {
      info.classification = 'MENU';
      return info;
    }

    // Check if it auto-enters interactive mode when args/flags are missing
    // Pattern 1: prompts when !flags.someValue
    const autoPromptPattern1 = /if\s*\(\s*(!flags\.|!args\.)\w+\s*\)/;
    // Pattern 2: prompts when (flags.interactive || !flags.someValue)
    const autoPromptPattern2 = /if\s*\(\s*flags\.interactive\s*\|\|\s*(!flags\.|!args\.)/;
    // Pattern 3: prompts when (!args.someValue && !flags.someValue)
    const autoPromptPattern3 = /if\s*\(\s*!args\.\w+\s*&&\s*!flags\.\w+\s*\)/;
    // Pattern 4: direct interactive mode trigger
    const autoPromptPattern4 = /if\s*\(\s*flags\.interactive\s*\|\|\s*!\w+\s*\)/;

    info.autoEntersInteractive = autoPromptPattern1.test(content) ||
                                  autoPromptPattern2.test(content) ||
                                  autoPromptPattern3.test(content) ||
                                  autoPromptPattern4.test(content);

    // Identify error-on-missing pattern (anti-pattern)
    // Pattern: this.error('...') when missing required values without prompting
    // Note: We specifically look for "use -i" or "use --interactive" which indicates
    // the command requires explicit interactive flag rather than auto-prompting
    const errorRequiringInteractiveFlag = /this\.error\s*\(\s*['"`].*(?:use -i|use --interactive).*['"`]/i;
    const hasErrorOnMissing = errorRequiringInteractiveFlag.test(content);

    // Classification logic
    if (!info.hasFlags && !info.hasArgs) {
      info.classification = 'N/A';
    } else if (!info.hasRequiredFlags && !info.hasRequiredArgs && !content.includes('validate')) {
      // Optional args/flags only - check if it prompts when missing
      if (info.usesInquirer && info.autoEntersInteractive) {
        info.classification = 'GOOD';
      } else if (info.usesInquirer) {
        info.classification = 'GOOD'; // Has inquirer, likely interactive
      } else {
        info.classification = 'N/A';
      }
    } else if (info.usesInquirer && info.autoEntersInteractive && !hasErrorOnMissing) {
      info.classification = 'GOOD';
    } else if (hasErrorOnMissing && !info.autoEntersInteractive) {
      info.classification = 'NEEDS_FIX';
      info.issues.push('Errors when required values missing instead of prompting');
    } else if (info.hasInteractiveFlag && hasErrorOnMissing) {
      info.classification = 'NEEDS_FIX';
      info.issues.push('Requires explicit -i flag instead of auto-prompting');
    } else {
      info.classification = info.usesInquirer ? 'GOOD' : 'N/A';
    }

    return info;
  }

  function getAllCommandFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllCommandFiles(fullPath));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  let allCommands: CommandInfo[];

  before(() => {
    const commandFiles = getAllCommandFiles(commandsDir);
    allCommands = commandFiles.map(analyzeCommandFile);
  });

  describe('Command Analysis', () => {
    it('should find all command files', () => {
      expect(allCommands.length).to.be.greaterThan(0);
      console.log(`\n  Found ${allCommands.length} command files\n`);
    });

    it('should report commands using inquirer for interactivity', () => {
      const withInquirer = allCommands.filter(c => c.usesInquirer);
      console.log(`  ${withInquirer.length} commands use inquirer for interactive mode`);
      expect(withInquirer.length).to.be.greaterThan(0);
    });

    it('should report command classifications', () => {
      const good = allCommands.filter(c => c.classification === 'GOOD');
      const needsFix = allCommands.filter(c => c.classification === 'NEEDS_FIX');
      const na = allCommands.filter(c => c.classification === 'N/A');
      const menu = allCommands.filter(c => c.classification === 'MENU');

      console.log(`  Classifications:`);
      console.log(`    GOOD (prompts for missing): ${good.length}`);
      console.log(`    NEEDS_FIX (errors on missing): ${needsFix.length}`);
      console.log(`    N/A (no required input): ${na.length}`);
      console.log(`    MENU (always interactive): ${menu.length}`);

      if (needsFix.length > 0) {
        console.log(`\n  Commands needing fix:`);
        for (const cmd of needsFix) {
          console.log(`    - ${cmd.relativePath}: ${cmd.issues.join(', ')}`);
        }
      }
    });
  });

  describe('Interactive Mode Pattern Compliance', () => {
    /**
     * Core Test: All commands with required data should auto-enter interactive mode
     *
     * This test fails if any command requires flags/args but doesn't provide
     * an interactive fallback when they're missing.
     */
    it('all commands with required inputs should support auto-interactive mode', () => {
      const needsFix = allCommands.filter(c => c.classification === 'NEEDS_FIX');

      if (needsFix.length > 0) {
        const failures = needsFix.map(c =>
          `${c.relativePath}: ${c.issues.join(', ')}`
        ).join('\n  ');

        expect.fail(
          `${needsFix.length} command(s) require interactive mode fix:\n  ${failures}`
        );
      }
    });

    it('commands with flags should use inquirer for prompts', () => {
      const withRequiredData = allCommands.filter(
        c => (c.hasRequiredFlags || c.hasRequiredArgs) && c.classification !== 'N/A'
      );

      const withoutInquirer = withRequiredData.filter(c => !c.usesInquirer);

      if (withoutInquirer.length > 0) {
        console.log(`\n  Commands with required data but no inquirer:`);
        for (const cmd of withoutInquirer) {
          console.log(`    - ${cmd.relativePath}`);
        }
      }

      // This is informational - some commands may legitimately not need prompts
    });
  });

  describe('Specific Command Checks', () => {
    // Ticket commands
    it('ticket/create should auto-prompt for title', () => {
      const cmd = allCommands.find(c => c.relativePath === 'ticket/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    it('ticket/edit should auto-prompt for ticket selection', () => {
      const cmd = allCommands.find(c => c.relativePath === 'ticket/edit.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    it('ticket/move should auto-prompt for ticket and column', () => {
      const cmd = allCommands.find(c => c.relativePath === 'ticket/move.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    it('ticket/delete should auto-prompt for ticket selection', () => {
      const cmd = allCommands.find(c => c.relativePath === 'ticket/delete.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    // Epic commands
    it('epic/create should auto-prompt for title', () => {
      const cmd = allCommands.find(c => c.relativePath === 'epic/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    it('epic/move should auto-prompt for epic and status', () => {
      const cmd = allCommands.find(c => c.relativePath === 'epic/move.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    // Spec commands
    it('spec/create should auto-prompt for title', () => {
      const cmd = allCommands.find(c => c.relativePath === 'spec/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    // Status commands - these are the ones that need fixes
    it('status/create should auto-prompt for name and category', () => {
      const cmd = allCommands.find(c => c.relativePath === 'status/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification,
        'status/create.ts should auto-prompt when name or category is missing'
      ).to.equal('GOOD');
    });

    it('status/update should auto-prompt for changes', () => {
      const cmd = allCommands.find(c => c.relativePath === 'status/update.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification,
        'status/update.ts should auto-prompt instead of requiring -i flag'
      ).to.equal('GOOD');
    });

    it('status/move should auto-prompt for id and position', () => {
      const cmd = allCommands.find(c => c.relativePath === 'status/move.ts');
      expect(cmd).to.exist;
      expect(cmd!.classification,
        'status/move.ts should auto-prompt when id or position is missing'
      ).to.not.equal('NEEDS_FIX');
    });

    // Phase commands - these are the ones that need fixes
    it('phase/create should auto-prompt for name and category', () => {
      const cmd = allCommands.find(c => c.relativePath === 'phase/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification,
        'phase/create.ts should auto-prompt when name or category is missing'
      ).to.equal('GOOD');
    });

    it('phase/update should auto-prompt for changes', () => {
      const cmd = allCommands.find(c => c.relativePath === 'phase/update.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification,
        'phase/update.ts should auto-prompt instead of requiring -i flag'
      ).to.equal('GOOD');
    });

    it('phase/move should auto-prompt for id and position', () => {
      const cmd = allCommands.find(c => c.relativePath === 'phase/move.ts');
      expect(cmd).to.exist;
      expect(cmd!.classification,
        'phase/move.ts should auto-prompt when id or position is missing'
      ).to.not.equal('NEEDS_FIX');
    });

    // Branch commands
    it('branch/create should auto-prompt via wizard', () => {
      const cmd = allCommands.find(c => c.relativePath === 'branch/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });

    // Action commands
    it('action/create should auto-prompt for name and prompt', () => {
      const cmd = allCommands.find(c => c.relativePath === 'action/create.ts');
      expect(cmd).to.exist;
      expect(cmd!.usesInquirer).to.be.true;
      expect(cmd!.classification).to.equal('GOOD');
    });
  });
});
