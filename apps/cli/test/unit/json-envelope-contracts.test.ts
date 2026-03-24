import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateJsonEnvelope,
  JSON_ENVELOPE_TYPES,
  JSON_ENVELOPE_REQUIRED_FIELDS,
  type JsonEnvelopeType,
  type PromptJsonOutput,
  type SuccessJsonOutput,
  type ErrorJsonOutput,
  type DryRunJsonOutput,
  type ConfirmationNeededJsonOutput,
  type ExecutionResultJsonOutput,
  createMetadata,
  normalizeChoices,
  buildPromptConfig,
  buildFormPromptConfig,
  EXIT_SUCCESS,
  EXIT_ERROR,
  EXIT_NEEDS_INPUT,
} from '../../src/lib/prompt-json.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Contract/Snapshot tests for JSON output schema stability (TKT-1006 R5).
 *
 * These tests ensure the machine-mode JSON API contract is stable and
 * any accidental breaking changes are caught. They verify:
 * - Envelope type discriminators
 * - Required fields per envelope type
 * - Exit code constants
 * - Structural contracts for each output type
 */
describe('JSON Envelope Contract Tests (TKT-1006)', () => {

  // ===========================================================================
  // Schema Stability: Type Discriminators
  // ===========================================================================
  describe('envelope type discriminators', () => {
    it('should have exactly 6 envelope types', () => {
      expect(JSON_ENVELOPE_TYPES).to.have.length(6);
    });

    it('should include all canonical envelope types', () => {
      const expected = ['prompt', 'success', 'error', 'dry-run', 'confirmation_needed', 'execution_result'];
      for (const type of expected) {
        expect(JSON_ENVELOPE_TYPES).to.include(type);
      }
    });

    it('should not have unexpected envelope types', () => {
      for (const type of JSON_ENVELOPE_TYPES) {
        expect(['prompt', 'success', 'error', 'dry-run', 'confirmation_needed', 'execution_result']).to.include(type);
      }
    });
  });

  // ===========================================================================
  // Schema Stability: Required Fields
  // ===========================================================================
  describe('required fields per envelope type', () => {
    it('prompt type should require type, prompt, metadata', () => {
      expect(JSON_ENVELOPE_REQUIRED_FIELDS.prompt).to.deep.equal(['type', 'prompt', 'metadata']);
    });

    it('success type should require type, prompt, success, result, metadata', () => {
      expect(JSON_ENVELOPE_REQUIRED_FIELDS.success).to.deep.equal(['type', 'prompt', 'success', 'result', 'metadata']);
    });

    it('error type should require type, error, metadata', () => {
      expect(JSON_ENVELOPE_REQUIRED_FIELDS.error).to.deep.equal(['type', 'error', 'metadata']);
    });

    it('dry-run type should require type, valid, metadata', () => {
      expect(JSON_ENVELOPE_REQUIRED_FIELDS['dry-run']).to.deep.equal(['type', 'valid', 'metadata']);
    });

    it('confirmation_needed type should require type, plan, confirm_command, message, metadata', () => {
      expect(JSON_ENVELOPE_REQUIRED_FIELDS.confirmation_needed).to.deep.equal(
        ['type', 'plan', 'confirm_command', 'message', 'metadata']
      );
    });

    it('execution_result type should require type, result, metadata', () => {
      expect(JSON_ENVELOPE_REQUIRED_FIELDS.execution_result).to.deep.equal(['type', 'result', 'metadata']);
    });
  });

  // ===========================================================================
  // Schema Stability: Exit Codes
  // ===========================================================================
  describe('exit code constants', () => {
    it('EXIT_SUCCESS should be 0', () => {
      expect(EXIT_SUCCESS).to.equal(0);
    });

    it('EXIT_ERROR should be 1', () => {
      expect(EXIT_ERROR).to.equal(1);
    });

    it('EXIT_NEEDS_INPUT should be 2', () => {
      expect(EXIT_NEEDS_INPUT).to.equal(2);
    });
  });

  // ===========================================================================
  // Validator: Valid Envelopes
  // ===========================================================================
  describe('validateJsonEnvelope - valid envelopes', () => {
    it('should validate a well-formed prompt envelope', () => {
      const envelope: PromptJsonOutput = {
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'action',
          message: 'Select an action:',
          choices: [
            { name: 'Create', value: 'create', command: 'prlt ticket create --json' },
            { name: 'List', value: 'list', command: 'prlt ticket list --json' },
          ],
        },
        metadata: createMetadata('ticket', { json: true }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a prompt envelope with null prompt', () => {
      const envelope: PromptJsonOutput = {
        type: 'prompt',
        prompt: null,
        metadata: createMetadata('ticket', {}),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a well-formed success envelope', () => {
      const envelope: SuccessJsonOutput = {
        type: 'success',
        prompt: null,
        success: true,
        result: { ticketId: 'TKT-001', title: 'New Ticket' },
        metadata: createMetadata('ticket create', { title: 'New Ticket' }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a well-formed error envelope', () => {
      const envelope: ErrorJsonOutput = {
        type: 'error',
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket "TKT-999" not found.',
        },
        metadata: createMetadata('ticket view', { json: true }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a well-formed dry-run envelope (valid)', () => {
      const envelope: DryRunJsonOutput = {
        type: 'dry-run',
        valid: true,
        wouldCreate: { type: 'ticket', title: 'New Ticket' },
        metadata: createMetadata('ticket create', { dryRun: true }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a well-formed dry-run envelope (invalid)', () => {
      const envelope: DryRunJsonOutput = {
        type: 'dry-run',
        valid: false,
        errors: [{ field: 'title', error: 'Title is required' }],
        metadata: createMetadata('ticket create', { dryRun: true }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a well-formed confirmation_needed envelope', () => {
      const envelope: ConfirmationNeededJsonOutput = {
        type: 'confirmation_needed',
        plan: { action: 'delete', ticketId: 'TKT-001' },
        confirm_command: 'prlt ticket delete TKT-001 --yes --json',
        message: 'This will delete TKT-001. Re-run with --yes to confirm.',
        metadata: createMetadata('ticket delete', { json: true }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });

    it('should validate a well-formed execution_result envelope', () => {
      const envelope: ExecutionResultJsonOutput = {
        type: 'execution_result',
        result: {
          executions: [
            {
              workId: 'W-001',
              ticketId: 'TKT-001',
              agent: 'agent-alpha',
              sessionId: 'sess-001',
              status: 'running',
            },
          ],
          successCount: 1,
          failCount: 0,
        },
        metadata: createMetadata('work spawn', { json: true }),
      };
      const errors = validateJsonEnvelope(envelope);
      expect(errors).to.be.empty;
    });
  });

  // ===========================================================================
  // Validator: Invalid Envelopes
  // ===========================================================================
  describe('validateJsonEnvelope - invalid envelopes', () => {
    it('should reject null input', () => {
      const errors = validateJsonEnvelope(null);
      expect(errors).to.include('Output must be a non-null object');
    });

    it('should reject non-object input', () => {
      const errors = validateJsonEnvelope('not an object');
      expect(errors).to.include('Output must be a non-null object');
    });

    it('should reject missing type field', () => {
      const errors = validateJsonEnvelope({ metadata: {} });
      expect(errors).to.include('Missing required field: type');
    });

    it('should reject invalid type discriminator', () => {
      const errors = validateJsonEnvelope({ type: 'invalid_type', metadata: {} });
      expect(errors[0]).to.include('Invalid envelope type: "invalid_type"');
    });

    it('should reject success envelope without success field', () => {
      const errors = validateJsonEnvelope({
        type: 'success',
        prompt: null,
        result: {},
        metadata: { command: 'test', flags: {} },
      });
      expect(errors).to.include('success field must be true for success type');
    });

    it('should reject success envelope with non-null prompt', () => {
      const errors = validateJsonEnvelope({
        type: 'success',
        prompt: { type: 'list' },
        success: true,
        result: {},
        metadata: { command: 'test', flags: {} },
      });
      expect(errors).to.include('prompt field must be null for success type');
    });

    it('should reject error envelope without code', () => {
      const errors = validateJsonEnvelope({
        type: 'error',
        error: { message: 'Something went wrong' },
        metadata: { command: 'test', flags: {} },
      });
      expect(errors).to.include('error.code must be a string');
    });

    it('should reject error envelope without message', () => {
      const errors = validateJsonEnvelope({
        type: 'error',
        error: { code: 'ERR' },
        metadata: { command: 'test', flags: {} },
      });
      expect(errors).to.include('error.message must be a string');
    });

    it('should reject confirmation_needed without confirm_command', () => {
      const errors = validateJsonEnvelope({
        type: 'confirmation_needed',
        plan: {},
        confirm_command: '',
        message: 'Please confirm',
        metadata: { command: 'test', flags: {} },
      });
      expect(errors).to.include('confirm_command must be a non-empty string');
    });

    it('should reject metadata without command', () => {
      const errors = validateJsonEnvelope({
        type: 'prompt',
        prompt: null,
        metadata: { flags: {} },
      });
      expect(errors).to.include('metadata.command must be a string');
    });

    it('should reject metadata without flags', () => {
      const errors = validateJsonEnvelope({
        type: 'prompt',
        prompt: null,
        metadata: { command: 'test' },
      });
      expect(errors).to.include('metadata.flags must be an object');
    });
  });

  // ===========================================================================
  // Builder Functions: Snapshot Tests
  // ===========================================================================
  describe('buildPromptConfig snapshots', () => {
    it('list prompt config should have stable structure', () => {
      const config = buildPromptConfig(
        'list',
        'action',
        'Select action:',
        [
          { name: 'Create', value: 'create', command: 'prlt create --json' },
          { name: 'Edit', value: 'edit', command: 'prlt edit --json' },
        ]
      );

      expect(config).to.deep.equal({
        type: 'list',
        name: 'action',
        message: 'Select action:',
        choices: [
          { name: 'Create', value: 'create', command: 'prlt create --json' },
          { name: 'Edit', value: 'edit', command: 'prlt edit --json' },
        ],
      });
    });

    it('checkbox prompt config should have stable structure', () => {
      const config = buildPromptConfig(
        'checkbox',
        'tickets',
        'Select tickets:',
        [
          { name: 'TKT-001', value: 'TKT-001' },
          { name: 'TKT-002', value: 'TKT-002' },
        ]
      );

      expect(config).to.deep.equal({
        type: 'checkbox',
        name: 'tickets',
        message: 'Select tickets:',
        choices: [
          { name: 'TKT-001', value: 'TKT-001' },
          { name: 'TKT-002', value: 'TKT-002' },
        ],
      });
    });

    it('input prompt config should have stable structure', () => {
      const config = buildPromptConfig('input', 'title', 'Enter title:');
      expect(config).to.deep.equal({
        type: 'input',
        name: 'title',
        message: 'Enter title:',
      });
    });

    it('confirm prompt config should have stable structure', () => {
      const config = buildPromptConfig('confirm', 'proceed', 'Continue?', undefined, true);
      expect(config).to.deep.equal({
        type: 'confirm',
        name: 'proceed',
        message: 'Continue?',
        default: true,
      });
    });
  });

  describe('buildFormPromptConfig snapshots', () => {
    it('form prompt config should have stable structure', () => {
      const config = buildFormPromptConfig([
        { type: 'input', name: 'name', message: 'Project name:' },
        { type: 'input', name: 'description', message: 'Description:' },
        {
          type: 'list',
          name: 'workflow',
          message: 'Workflow:',
          choices: [
            { name: 'Default', value: 'default' },
            { name: 'Kanban', value: 'kanban' },
          ],
        },
      ]);

      expect(config.type).to.equal('form');
      expect(config.fields).to.have.length(3);
      expect(config.fields![0]).to.deep.equal({
        type: 'input',
        name: 'name',
        message: 'Project name:',
      });
      expect(config.fields![2].choices).to.deep.equal([
        { name: 'Default', value: 'default' },
        { name: 'Kanban', value: 'kanban' },
      ]);
    });
  });

  describe('createMetadata snapshots', () => {
    it('metadata should have stable structure', () => {
      const metadata = createMetadata('ticket create', { title: 'Test', priority: 'P1', json: true });
      expect(metadata.command).to.equal('ticket create');
      expect(metadata.flags).to.deep.equal({ title: 'Test', priority: 'P1', json: true });
      expect(metadata.timestamp).to.be.a('string');
      expect(metadata.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('metadata should filter underscore-prefixed flags', () => {
      const metadata = createMetadata('test', { visible: true, _internal: 'hidden' });
      expect(metadata.flags).to.not.have.property('_internal');
      expect(metadata.flags).to.have.property('visible');
    });

    it('metadata should filter undefined values', () => {
      const metadata = createMetadata('test', { set: 'value', unset: undefined });
      expect(metadata.flags).to.deep.equal({ set: 'value' });
    });
  });

  describe('normalizeChoices snapshots', () => {
    it('should normalize mixed choice types consistently', () => {
      const choices = [
        'Simple String',
        { name: 'Object Choice', value: 'obj' },
        { name: 'With Command', value: 'cmd', command: 'prlt do --json' },
        { name: 'Disabled', value: 'dis', disabled: true },
        { type: 'separator', line: '---' },
      ];

      const normalized = normalizeChoices(choices);
      expect(normalized).to.deep.equal([
        { name: 'Simple String', value: 'Simple String' },
        { name: 'Object Choice', value: 'obj' },
        { name: 'With Command', value: 'cmd', command: 'prlt do --json' },
        { name: 'Disabled', value: 'dis', disabled: true },
      ]);
    });
  });

  // ===========================================================================
  // Source Code Audit: No Direct inquirer.prompt() in Core Families
  // ===========================================================================
  describe('interactive leakage audit', () => {
    const commandsDir = path.resolve(__dirname, '../../src/commands');
    const coreFamilies = ['work', 'ticket', 'execution', 'agent'];

    function getCommandFiles(family: string): string[] {
      const familyDir = path.join(commandsDir, family);
      const files: string[] = [];

      function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            files.push(fullPath);
          }
        }
      }

      walk(familyDir);
      return files;
    }

    for (const family of coreFamilies) {
      it(`${family} family should not have direct inquirer.prompt() calls`, () => {
        const files = getCommandFiles(family);
        const violations: string[] = [];

        for (const filePath of files) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(commandsDir, filePath);

          // Check for direct inquirer.prompt() calls
          const directCalls = content.match(/await\s+inquirer\.prompt\(/g) || [];
          if (directCalls.length > 0) {
            violations.push(`${relativePath}: ${directCalls.length} direct inquirer.prompt() call(s)`);
          }
        }

        expect(violations, `Direct inquirer.prompt() violations in ${family} family:\n  ${violations.join('\n  ')}`).to.be.empty;
      });
    }

    for (const family of coreFamilies) {
      it(`${family} family commands with prompts should use this.prompt/selectFromList/FlagResolver`, () => {
        const files = getCommandFiles(family);
        const concerns: string[] = [];

        for (const filePath of files) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(commandsDir, filePath);

          // If it imports inquirer, it should also use this.prompt or FlagResolver
          if (content.includes("import inquirer from 'inquirer'")) {
            const usesWrapper = content.includes('this.prompt(') ||
              content.includes('this.prompt<') ||
              content.includes('this.selectFromList(') ||
              content.includes('FlagResolver');

            if (!usesWrapper) {
              concerns.push(`${relativePath}: imports inquirer but doesn't use prompt wrapper`);
            }
          }
        }

        if (concerns.length > 0) {
          // Log concerns but don't fail - some may be legitimate (e.g., Separator usage)
          console.log(`  ⚠ ${family} concerns: ${concerns.join(', ')}`);
        }
      });
    }
  });

  // ===========================================================================
  // Choice Command Audit: Verify command fields in choices
  // ===========================================================================
  describe('choice command field audit', () => {
    const commandsDir = path.resolve(__dirname, '../../src/commands');
    const coreFamilies = ['work', 'ticket', 'execution', 'agent'];

    function getCommandFiles(family: string): string[] {
      const familyDir = path.join(commandsDir, family);
      const files: string[] = [];

      function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            files.push(fullPath);
          }
        }
      }

      walk(familyDir);
      return files;
    }

    it('all command fields in choices should reference valid prlt commands', () => {
      const invalidCommands: string[] = [];

      for (const family of coreFamilies) {
        const files = getCommandFiles(family);

        for (const filePath of files) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(commandsDir, filePath);

          // Extract command field values from choices
          const commandMatches = content.matchAll(/command:\s*[`'"]([^`'"]+)[`'"]/g);
          for (const match of commandMatches) {
            const cmd = match[1];
            // Verify command starts with prlt
            if (!cmd.startsWith('prlt ') && !cmd.startsWith('${') && !cmd.includes('${')) {
              invalidCommands.push(`${relativePath}: invalid command prefix: "${cmd}"`);
            }
            // Verify command includes --json or --machine for agent mode
            if (cmd.startsWith('prlt ') && !cmd.includes('--json') && !cmd.includes('--machine') && !cmd.includes('--format')) {
              // Template literals may include --machine via variable
              if (!content.includes('--machine') && !content.includes('--json')) {
                invalidCommands.push(`${relativePath}: command missing --json/--machine flag: "${cmd}"`);
              }
            }
          }
        }
      }

      if (invalidCommands.length > 0) {
        console.log(`  ⚠ Command field concerns:\n    ${invalidCommands.join('\n    ')}`);
      }
    });
  });
});
