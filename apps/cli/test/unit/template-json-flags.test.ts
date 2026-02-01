import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../../bin/run.js');

/**
 * Unit tests for template/* command FlagResolver JSON mode support
 * Verifies that all template commands properly use FlagResolver for JSON mode
 */
describe('Template Commands FlagResolver JSON Mode Support', () => {
  // Helper to run CLI and get output
  function runCli(args: string): string {
    try {
      return execSync(`node ${CLI_PATH} ${args} 2>&1`, {
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch (error) {
      // Return stderr/stdout even on error (JSON mode exits with code 2)
      return (error as { stdout?: string; stderr?: string }).stdout ||
             (error as { stderr?: string }).stderr || '';
    }
  }

  describe('template index (FlagResolver)', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template --help');
      expect(output).to.include('--json');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template --json');
      const json = JSON.parse(output);
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c: { command?: string }) => c.command)).to.be.true;
    });

    it('should include navigation commands in choices', () => {
      const output = runCli('template --json');
      const json = JSON.parse(output);
      const commands = json.prompt.choices.map((c: { command: string }) => c.command);
      expect(commands).to.include('prlt template list --json');
      expect(commands).to.include('prlt template ticket --json');
      expect(commands).to.include('prlt template phase --json');
    });
  });

  describe('template phase index (FlagResolver)', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase --help');
      expect(output).to.include('--json');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template phase --json');
      const json = JSON.parse(output);
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c: { command?: string }) => c.command)).to.be.true;
    });
  });

  describe('template ticket index (FlagResolver)', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket --help');
      expect(output).to.include('--json');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template ticket --json');
      const json = JSON.parse(output);
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c: { command?: string }) => c.command)).to.be.true;
    });
  });

  describe('template delete (FlagResolver)', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template delete --help');
      expect(output).to.include('--json');
    });
  });

  // Passthrough commands still need --json flag
  describe('template phase create', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase create --help');
      expect(output).to.include('--json');
    });
  });

  describe('template phase update', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template phase update --help');
      expect(output).to.include('--json');
    });
  });

  describe('template ticket save', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket save --help');
      expect(output).to.include('--json');
    });
  });

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
});
