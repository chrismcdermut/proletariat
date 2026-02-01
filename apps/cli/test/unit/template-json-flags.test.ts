import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../../bin/run.js');

/**
 * Unit tests for template/* command JSON flag support
 * Verifies that all template passthrough commands properly declare and pass through the --json flag
 */
describe('Template Commands JSON Flag Support', () => {
  // Helper to run CLI and get output
  function runCli(args: string): string {
    try {
      return execSync(`node ${CLI_PATH} ${args} 2>&1`, {
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch (error) {
      // Return stderr/stdout even on error (help commands exit with non-zero)
      return (error as { stdout?: string; stderr?: string }).stdout ||
             (error as { stderr?: string }).stderr || '';
    }
  }

  describe('template phase create', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase create --help');
      expect(output).to.include('--json');
      expect(output).to.include('Output prompt configuration as JSON');
    });

    it('should include --json in usage example', () => {
      const output = runCli('template phase create --help');
      expect(output).to.include('[--json]');
    });
  });

  describe('template phase update', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase update --help');
      expect(output).to.include('--json');
      expect(output).to.include('Output prompt configuration as JSON');
    });

    it('should include --json in usage example', () => {
      const output = runCli('template phase update --help');
      expect(output).to.include('[--json]');
    });
  });

  describe('template ticket save', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket save --help');
      expect(output).to.include('--json');
      expect(output).to.include('Output prompt configuration as JSON');
    });

    it('should include --json in usage example', () => {
      const output = runCli('template ticket save --help');
      expect(output).to.include('[--json]');
    });
  });

  // Verify existing template commands that already had JSON support still work
  describe('template phase apply', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase apply --help');
      expect(output).to.include('--json');
    });
  });

  describe('template phase list', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase list --help');
      expect(output).to.include('--json');
    });
  });

  describe('template phase delete', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase delete --help');
      expect(output).to.include('--json');
    });
  });

  describe('template ticket apply', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket apply --help');
      expect(output).to.include('--json');
    });
  });

  describe('template ticket list', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket list --help');
      expect(output).to.include('--json');
    });
  });

  describe('template ticket delete', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket delete --help');
      expect(output).to.include('--json');
    });
  });

  describe('template index', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template --help');
      expect(output).to.include('--json');
    });
  });

  describe('template delete', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template delete --help');
      expect(output).to.include('--json');
    });
  });
});
