/**
 * E2E Agent Flow Tests for template/* commands
 *
 * Tests that AI agents can navigate through template commands using --machine flag,
 * following the command field in each choice to reach the desired action.
 *
 * Note: Template index commands (template, template phase, template ticket) don't
 * require PMO context - they just present menu options. This allows testing them
 * without a full test database setup.
 */

import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.join(__dirname, '../../bin/run.js');

interface AgentPromptChoice {
  name: string;
  value: string;
  command?: string;
}

interface AgentPromptResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices: AgentPromptChoice[];
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
  };
}

// Helper to run CLI and get output
function runCli(args: string): string {
  try {
    return execSync(`node ${CLI_PATH} ${args} 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch (error) {
    // JSON mode exits with code 2, so we catch and return output
    return (error as { stdout?: string; stderr?: string }).stdout ||
           (error as { stderr?: string }).stderr || '';
  }
}

// Parse JSON from CLI output, handling warnings/noise
function parseAgentResponse(output: string): AgentPromptResponse | null {
  const lines = output.split('\n');
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{')) {
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

// Find choice by partial name match
function findChoice(choices: AgentPromptChoice[], pattern: string): AgentPromptChoice | undefined {
  return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
}

describe('Template Commands - Agent Flow E2E Tests', () => {
  describe('template index - menu navigation with --machine', () => {
    it('should output JSON prompt with command field for each choice', () => {
      const output = runCli('template --machine');
      const result = parseAgentResponse(output);

      expect(result, `Failed to parse JSON from: ${output.substring(0, 200)}`).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices.length).to.be.greaterThan(0);

      // Each choice should have a command field
      for (const choice of result!.prompt.choices) {
        expect(choice.command, `Choice "${choice.name}" missing command`).to.exist;
        expect(choice.command).to.include('--json');
      }
    });

    it('should have list option that navigates to template:list', () => {
      const output = runCli('template --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices, 'List all templates');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('template list');
    });

    it('should have ticket option that navigates to template:ticket', () => {
      const output = runCli('template --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const ticketChoice = findChoice(result!.prompt.choices, 'Ticket templates');
      expect(ticketChoice).to.exist;
      expect(ticketChoice!.command).to.include('template ticket');
    });

    it('should have phase option that navigates to template:phase', () => {
      const output = runCli('template --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const phaseChoice = findChoice(result!.prompt.choices, 'Phase templates');
      expect(phaseChoice).to.exist;
      expect(phaseChoice!.command).to.include('template phase');
    });
  });

  describe('template phase index - menu navigation with --machine', () => {
    it('should output JSON prompt with command field for each choice', () => {
      const output = runCli('template phase --machine');
      const result = parseAgentResponse(output);

      expect(result, `Failed to parse JSON from: ${output.substring(0, 200)}`).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');

      // Each choice should have a command field
      for (const choice of result!.prompt.choices) {
        expect(choice.command, `Choice "${choice.name}" missing command`).to.exist;
      }
    });

    it('should have list option', () => {
      const output = runCli('template phase --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices, 'List phase templates');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('list');
    });

    it('should have apply option', () => {
      const output = runCli('template phase --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const applyChoice = findChoice(result!.prompt.choices, 'Apply');
      expect(applyChoice).to.exist;
      expect(applyChoice!.command).to.include('apply');
    });

    it('should have create option', () => {
      const output = runCli('template phase --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const createChoice = findChoice(result!.prompt.choices, 'Create');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('create');
    });

    it('should have delete option', () => {
      const output = runCli('template phase --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const deleteChoice = findChoice(result!.prompt.choices, 'Delete');
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('delete');
    });
  });

  describe('template ticket index - menu navigation with --machine', () => {
    it('should output JSON prompt with command field for each choice', () => {
      const output = runCli('template ticket --machine');
      const result = parseAgentResponse(output);

      expect(result, `Failed to parse JSON from: ${output.substring(0, 200)}`).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');

      // Each choice should have a command field
      for (const choice of result!.prompt.choices) {
        expect(choice.command, `Choice "${choice.name}" missing command`).to.exist;
      }
    });

    it('should have list option', () => {
      const output = runCli('template ticket --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices, 'List ticket templates');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('list');
    });

    it('should have create option', () => {
      const output = runCli('template ticket --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const createChoice = findChoice(result!.prompt.choices, 'Create');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('create');
    });

    it('should have apply option (Create ticket from template)', () => {
      const output = runCli('template ticket --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const applyChoice = findChoice(result!.prompt.choices, 'Create ticket from template');
      expect(applyChoice).to.exist;
      expect(applyChoice!.command).to.include('apply');
    });

    it('should have save option', () => {
      const output = runCli('template ticket --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const saveChoice = findChoice(result!.prompt.choices, 'Save');
      expect(saveChoice).to.exist;
      expect(saveChoice!.command).to.include('save');
    });

    it('should have delete option', () => {
      const output = runCli('template ticket --machine');
      const result = parseAgentResponse(output);
      expect(result).to.not.be.null;

      const deleteChoice = findChoice(result!.prompt.choices, 'Delete');
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('delete');
    });
  });

  describe('--json flag (legacy) support', () => {
    it('template --json should output same structure as --machine', () => {
      const machineOutput = runCli('template --machine');
      const jsonOutput = runCli('template --json');

      const machineResult = parseAgentResponse(machineOutput);
      const jsonResult = parseAgentResponse(jsonOutput);

      expect(machineResult).to.not.be.null;
      expect(jsonResult).to.not.be.null;
      expect(machineResult!.prompt.type).to.equal(jsonResult!.prompt.type);
      expect(machineResult!.prompt.choices.length).to.equal(jsonResult!.prompt.choices.length);
    });

    it('template phase --json should output same structure as --machine', () => {
      const machineOutput = runCli('template phase --machine');
      const jsonOutput = runCli('template phase --json');

      const machineResult = parseAgentResponse(machineOutput);
      const jsonResult = parseAgentResponse(jsonOutput);

      expect(machineResult).to.not.be.null;
      expect(jsonResult).to.not.be.null;
      expect(machineResult!.prompt.type).to.equal(jsonResult!.prompt.type);
    });

    it('template ticket --json should output same structure as --machine', () => {
      const machineOutput = runCli('template ticket --machine');
      const jsonOutput = runCli('template ticket --json');

      const machineResult = parseAgentResponse(machineOutput);
      const jsonResult = parseAgentResponse(jsonOutput);

      expect(machineResult).to.not.be.null;
      expect(jsonResult).to.not.be.null;
      expect(machineResult!.prompt.type).to.equal(jsonResult!.prompt.type);
    });
  });

  describe('help output includes --machine flag', () => {
    it('template --help should show --machine flag', () => {
      const output = runCli('template --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });

    it('template phase --help should show --machine flag', () => {
      const output = runCli('template phase --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });

    it('template ticket --help should show --machine flag', () => {
      const output = runCli('template ticket --help');
      expect(output).to.include('--machine');
      expect(output).to.include('-m');
    });
  });
});
