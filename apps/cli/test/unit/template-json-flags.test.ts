import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../../bin/run.js');

/**
 * Unit tests for template/* command machine-readable output mode support
 * Verifies that all template commands properly use machineOutputFlags for JSON mode
 */
describe('Template Commands Machine Output Mode Support', () => {
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

  // Helper to parse JSON from CLI output (handles warnings/noise)
  function parseJson(output: string): Record<string, unknown> | null {
    const lines = output.split('\n');
    let jsonStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('{')) {
        jsonStart = i;
        break;
      }
    }
    if (jsonStart === -1) return null;
    try {
      return JSON.parse(lines.slice(jsonStart).join('\n'));
    } catch {
      return null;
    }
  }

  describe('template index (machineOutputFlags)', () => {
    it('should have --machine flag in help', () => {
      const output = runCli('template --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template --machine');
      const json = parseJson(output) as { prompt: { type: string; choices: Array<{ command?: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c) => c.command)).to.be.true;
    });

    it('should include navigation commands in choices', () => {
      const output = runCli('template --machine');
      const json = parseJson(output) as { prompt: { choices: Array<{ command: string }> } };
      expect(json).to.not.be.null;
      const commands = json.prompt.choices.map((c) => c.command);
      expect(commands).to.include('prlt template list --json');
      expect(commands).to.include('prlt template ticket --json');
      expect(commands).to.include('prlt template phase --json');
    });
  });

  describe('template phase index (machineOutputFlags)', () => {
    it('should have --machine flag in help', () => {
      const output = runCli('template phase --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template phase --machine');
      const json = parseJson(output) as { prompt: { type: string; choices: Array<{ command?: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c) => c.command)).to.be.true;
    });
  });

  describe('template ticket index (machineOutputFlags)', () => {
    it('should have --machine flag in help', () => {
      const output = runCli('template ticket --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template ticket --machine');
      const json = parseJson(output) as { prompt: { type: string; choices: Array<{ command?: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c) => c.command)).to.be.true;
    });
  });

  describe('template delete (machineOutputFlags via pmoBaseFlags)', () => {
    it('should have --machine flag in help', () => {
      const output = runCli('template delete --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });
  });

  // Passthrough commands - verify they have --json flag for backward compatibility
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

    it('should have --template-name flag in help', () => {
      const output = runCli('template ticket save --help');
      expect(output).to.include('--template-name');
      expect(output).to.include('-n');
    });

    it('should have --machine flag in help', () => {
      const output = runCli('template ticket save --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
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

  describe('template ticket create', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--json');
    });

    it('should have --subtask flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--subtask');
    });

    it('should have --ac flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--ac');
    });

    it('should have --label flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--label');
    });

    it('should have --title-pattern flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--title-pattern');
    });

    it('should have --description-template flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--description-template');
    });

    it('should have --priority flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--priority');
    });

    it('should have --category flag in help', () => {
      const output = runCli('template ticket create --help');
      expect(output).to.include('--category');
    });

    it('should output JSON form prompt when --json flag is used without name', () => {
      const output = runCli('template ticket create --json');
      const json = parseJson(output) as { prompt: { type: string; fields: Array<{ name: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('form');
      expect(json.prompt.fields).to.be.an('array');
      // Should have name field in the form
      const fieldNames = json.prompt.fields.map(f => f.name);
      expect(fieldNames).to.include('name');
    });
  });

  describe('ticket template create (underlying implementation)', () => {
    it('should have --json flag in help', () => {
      const output = runCli('ticket template create --help');
      expect(output).to.include('--json');
    });

    it('should have --subtask flag in help', () => {
      const output = runCli('ticket template create --help');
      expect(output).to.include('--subtask');
    });

    it('should have --ac flag in help', () => {
      const output = runCli('ticket template create --help');
      expect(output).to.include('--ac');
    });

    it('should have --label flag in help', () => {
      const output = runCli('ticket template create --help');
      expect(output).to.include('--label');
    });

    it('should output JSON form prompt when --json flag is used without name', () => {
      const output = runCli('ticket template create --json');
      const json = parseJson(output) as { prompt: { type: string; fields: Array<{ name: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('form');
      expect(json.prompt.fields).to.be.an('array');
      // Should have name field in the form
      const fieldNames = json.prompt.fields.map(f => f.name);
      expect(fieldNames).to.include('name');
    });
  });
});
