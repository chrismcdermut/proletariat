import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import {
  HooksManager,
  Hook,
  HookCondition,
  TicketMovedPayload,
  TicketCreatedPayload,
  loadHooksFromYaml,
  loadHooksFromDatabase,
  loadAllHooks,
  saveHookToDatabase,
  deleteHookFromDatabase,
  validateHook,
  generateHooksTemplate,
} from '../../src/lib/hooks/index.js';
import { Ticket, TicketStatus } from '../../src/lib/pmo/types.js';

describe('Hooks System', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // HooksManager Tests
  // ==========================================================================

  describe('HooksManager', () => {
    let manager: HooksManager;
    const pmoPath = '/tmp/test-pmo';

    beforeEach(() => {
      manager = new HooksManager({
        workspacePath: testDir,
        pmoPath,
        log: () => {},
      });
    });

    describe('Hook Registration', () => {
      it('registers a hook', () => {
        const hook: Hook = {
          id: 'test-hook',
          name: 'Test Hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Test' }],
          enabled: true,
          source: 'yaml',
        };

        manager.registerHook(hook);

        expect(manager.getHook('test-hook')).to.deep.equal(hook);
      });

      it('registers multiple hooks', () => {
        const hooks: Hook[] = [
          {
            id: 'hook-1',
            name: 'Hook 1',
            event: 'ticket.created',
            actions: [{ type: 'log', message: 'Test 1' }],
            enabled: true,
            source: 'yaml',
          },
          {
            id: 'hook-2',
            name: 'Hook 2',
            event: 'ticket.moved',
            actions: [{ type: 'log', message: 'Test 2' }],
            enabled: true,
            source: 'yaml',
          },
        ];

        manager.registerHooks(hooks);

        expect(manager.getHooks()).to.have.length(2);
      });

      it('unregisters a hook', () => {
        const hook: Hook = {
          id: 'test-hook',
          name: 'Test Hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Test' }],
          enabled: true,
          source: 'yaml',
        };

        manager.registerHook(hook);
        const result = manager.unregisterHook('test-hook');

        expect(result).to.be.true;
        expect(manager.getHook('test-hook')).to.be.undefined;
      });

      it('returns false when unregistering non-existent hook', () => {
        const result = manager.unregisterHook('non-existent');
        expect(result).to.be.false;
      });

      it('clears all hooks', () => {
        manager.registerHook({
          id: 'hook-1',
          name: 'Hook 1',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Test' }],
          enabled: true,
          source: 'yaml',
        });

        manager.clearHooks();

        expect(manager.getHooks()).to.have.length(0);
      });
    });

    describe('Hook Lookup', () => {
      beforeEach(() => {
        manager.registerHooks([
          {
            id: 'created-hook',
            name: 'Created Hook',
            event: 'ticket.created',
            actions: [{ type: 'log', message: 'Created' }],
            enabled: true,
            source: 'yaml',
          },
          {
            id: 'moved-hook-1',
            name: 'Moved Hook 1',
            event: 'ticket.moved',
            actions: [{ type: 'log', message: 'Moved 1' }],
            enabled: true,
            source: 'yaml',
          },
          {
            id: 'moved-hook-2',
            name: 'Moved Hook 2',
            event: 'ticket.moved',
            actions: [{ type: 'log', message: 'Moved 2' }],
            enabled: true,
            source: 'yaml',
          },
        ]);
      });

      it('gets hooks for specific event', () => {
        const movedHooks = manager.getHooksForEvent('ticket.moved');
        expect(movedHooks).to.have.length(2);
      });

      it('returns empty array for event with no hooks', () => {
        const hooks = manager.getHooksForEvent('ticket.deleted');
        expect(hooks).to.have.length(0);
      });
    });

    describe('Condition Evaluation', () => {
      it('evaluates equals condition', () => {
        const conditions: HookCondition[] = [
          { field: 'toColumn', operator: 'equals', value: 'Ready' },
        ];

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
          fromColumn: 'Backlog',
          toColumn: 'Ready',
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.true;
      });

      it('evaluates not_equals condition', () => {
        const conditions: HookCondition[] = [
          { field: 'toColumn', operator: 'not_equals', value: 'Backlog' },
        ];

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
          fromColumn: 'Backlog',
          toColumn: 'Ready',
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.true;
      });

      it('evaluates nested field path', () => {
        const conditions: HookCondition[] = [
          { field: 'ticket.priority', operator: 'equals', value: 'HIGH' },
        ];

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: { ...createMockTicket(), priority: 'HIGH' },
          fromColumn: 'Backlog',
          toColumn: 'Ready',
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.true;
      });

      it('evaluates contains condition', () => {
        const conditions: HookCondition[] = [
          { field: 'ticket.title', operator: 'contains', value: 'Fix' },
        ];

        const payload: TicketCreatedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: { ...createMockTicket(), title: 'Fix login bug' },
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.true;
      });

      it('evaluates in condition', () => {
        const conditions: HookCondition[] = [
          { field: 'toColumn', operator: 'in', value: ['Ready', 'In Progress'] },
        ];

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
          fromColumn: 'Backlog',
          toColumn: 'Ready',
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.true;
      });

      it('evaluates multiple conditions (AND logic)', () => {
        const conditions: HookCondition[] = [
          { field: 'toColumn', operator: 'equals', value: 'Ready' },
          { field: 'ticket.priority', operator: 'equals', value: 'HIGH' },
        ];

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: { ...createMockTicket(), priority: 'HIGH' },
          fromColumn: 'Backlog',
          toColumn: 'Ready',
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.true;
      });

      it('fails when one condition does not match', () => {
        const conditions: HookCondition[] = [
          { field: 'toColumn', operator: 'equals', value: 'Ready' },
          { field: 'ticket.priority', operator: 'equals', value: 'HIGH' },
        ];

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: { ...createMockTicket(), priority: 'LOW' },
          fromColumn: 'Backlog',
          toColumn: 'Ready',
        };

        expect(manager.evaluateConditions(conditions, payload)).to.be.false;
      });

      it('matches when no conditions are specified', () => {
        expect(manager.evaluateConditions([], {} as any)).to.be.true;
      });
    });

    describe('Event Emission', () => {
      it('executes hooks for emitted event', async () => {
        let loggedMessage = '';
        const logManager = new HooksManager({
          workspacePath: testDir,
          pmoPath,
          log: (msg) => { loggedMessage = msg; },
        });

        logManager.registerHook({
          id: 'log-hook',
          name: 'Log Hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Ticket created: {{ticket.id}}' }],
          enabled: true,
          source: 'yaml',
        });

        const payload: TicketCreatedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
        };

        const results = await logManager.emit('ticket.created', payload);

        expect(results).to.have.length(1);
        expect(results[0].success).to.be.true;
        expect(loggedMessage).to.include('TEST-001');
      });

      it('skips disabled hooks', async () => {
        manager.registerHook({
          id: 'disabled-hook',
          name: 'Disabled Hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Should not run' }],
          enabled: false,
          source: 'yaml',
        });

        const payload: TicketCreatedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
        };

        const results = await manager.emit('ticket.created', payload);

        expect(results).to.have.length(1);
        expect(results[0].skipped).to.be.true;
      });

      it('skips hooks when conditions not met', async () => {
        manager.registerHook({
          id: 'conditional-hook',
          name: 'Conditional Hook',
          event: 'ticket.moved',
          conditions: [{ field: 'toColumn', operator: 'equals', value: 'Done' }],
          actions: [{ type: 'log', message: 'Should not run' }],
          enabled: true,
          source: 'yaml',
        });

        const payload: TicketMovedPayload = {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
          fromColumn: 'Backlog',
          toColumn: 'Ready', // Not 'Done'
        };

        const results = await manager.emit('ticket.moved', payload);

        expect(results).to.have.length(1);
        expect(results[0].conditionsMatched).to.be.false;
        expect(results[0].skipped).to.be.true;
      });

      it('returns empty array when hooks disabled globally', async () => {
        manager.registerHook({
          id: 'test-hook',
          name: 'Test Hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Test' }],
          enabled: true,
          source: 'yaml',
        });

        manager.disable();

        const results = await manager.emit('ticket.created', {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
        });

        expect(results).to.have.length(0);
      });

      it('executes hooks in priority order', async () => {
        const executionOrder: string[] = [];

        manager.registerHooks([
          {
            id: 'low-priority',
            name: 'Low Priority',
            event: 'ticket.created',
            actions: [{ type: 'log', message: 'low' }],
            enabled: true,
            source: 'yaml',
            priority: 100,
          },
          {
            id: 'high-priority',
            name: 'High Priority',
            event: 'ticket.created',
            actions: [{ type: 'log', message: 'high' }],
            enabled: true,
            source: 'yaml',
            priority: 1,
          },
        ]);

        const results = await manager.emit('ticket.created', {
          timestamp: new Date(),
          projectId: 'test',
          ticket: createMockTicket(),
        });

        // High priority should execute first
        expect(results[0].hook.id).to.equal('high-priority');
        expect(results[1].hook.id).to.equal('low-priority');
      });
    });
  });

  // ==========================================================================
  // Loader Tests
  // ==========================================================================

  describe('Hooks Loader', () => {
    describe('YAML Loading', () => {
      it('loads hooks from hooks.yaml', () => {
        // Create test directory structure
        const proletariatDir = path.join(testDir, '.proletariat');
        fs.mkdirSync(proletariatDir, { recursive: true });

        // Write test hooks.yaml
        const hooksYaml = `
version: 1
hooks:
  - name: test_hook
    event: ticket.moved
    conditions:
      - field: toColumn
        operator: equals
        value: Ready
    actions:
      - type: log
        message: Test message
    enabled: true
`;
        fs.writeFileSync(path.join(proletariatDir, 'hooks.yaml'), hooksYaml);

        const hooks = loadHooksFromYaml(testDir);

        expect(hooks).to.have.length(1);
        expect(hooks[0].name).to.equal('test_hook');
        expect(hooks[0].event).to.equal('ticket.moved');
        expect(hooks[0].source).to.equal('yaml');
      });

      it('returns empty array when hooks.yaml does not exist', () => {
        const hooks = loadHooksFromYaml(testDir);
        expect(hooks).to.have.length(0);
      });

      it('applies defaults to hooks', () => {
        const proletariatDir = path.join(testDir, '.proletariat');
        fs.mkdirSync(proletariatDir, { recursive: true });

        const hooksYaml = `
version: 1
defaults:
  enabled: false
  spawn_agent:
    strategy: least-busy
hooks:
  - name: test_hook
    event: ticket.created
    actions:
      - type: spawn_agent
`;
        fs.writeFileSync(path.join(proletariatDir, 'hooks.yaml'), hooksYaml);

        const hooks = loadHooksFromYaml(testDir);

        expect(hooks[0].enabled).to.be.false;
        expect(hooks[0].actions[0]).to.have.property('strategy', 'least-busy');
      });
    });

    describe('Database Loading', () => {
      let db: Database.Database;
      let dbPath: string;

      beforeEach(() => {
        dbPath = path.join(testDir, 'test.db');
        db = new Database(dbPath);
        db.exec(`
          CREATE TABLE workspace_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);
      });

      afterEach(() => {
        db.close();
      });

      it('loads hooks from database', () => {
        const hook: Hook = {
          id: 'db-hook',
          name: 'Database Hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Test' }],
          enabled: true,
          source: 'database',
        };

        saveHookToDatabase(db, hook);

        const hooks = loadHooksFromDatabase(db);

        expect(hooks).to.have.length(1);
        expect(hooks[0].name).to.equal('Database Hook');
        expect(hooks[0].source).to.equal('database');
      });

      it('deletes hook from database', () => {
        const hook: Hook = {
          id: 'to-delete',
          name: 'To Delete',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Test' }],
          enabled: true,
          source: 'database',
        };

        saveHookToDatabase(db, hook);
        const deleted = deleteHookFromDatabase(db, 'to-delete');

        expect(deleted).to.be.true;
        expect(loadHooksFromDatabase(db)).to.have.length(0);
      });
    });

    describe('Combined Loading', () => {
      it('database hooks override YAML hooks with same ID', () => {
        // Create YAML hook
        const proletariatDir = path.join(testDir, '.proletariat');
        fs.mkdirSync(proletariatDir, { recursive: true });

        // Use 'shared-hook' as name so it slugifies to 'shared-hook' as ID
        const hooksYaml = `
hooks:
  - name: shared-hook
    event: ticket.created
    actions:
      - type: log
        message: YAML version
    enabled: true
`;
        fs.writeFileSync(path.join(proletariatDir, 'hooks.yaml'), hooksYaml);

        // Create database hook with same ID (matching the slugified name)
        const dbPath = path.join(testDir, 'test.db');
        const db = new Database(dbPath);
        db.exec(`
          CREATE TABLE workspace_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);

        const dbHook: Hook = {
          id: 'shared-hook',  // Must match slugified name from YAML
          name: 'shared-hook',
          event: 'ticket.created',
          actions: [{ type: 'log', message: 'Database version' }],
          enabled: false,
          source: 'database',
        };
        saveHookToDatabase(db, dbHook);

        // Load all hooks
        const hooks = loadAllHooks(testDir, db);
        db.close();

        // Should only have one hook, the database version
        expect(hooks).to.have.length(1);
        expect(hooks[0].enabled).to.be.false;
        expect(hooks[0].actions[0]).to.have.property('message', 'Database version');
      });
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('Hook Validation', () => {
    it('validates valid hook', () => {
      const hook: Partial<Hook> = {
        name: 'Valid Hook',
        event: 'ticket.created',
        actions: [{ type: 'log', message: 'Test' }],
      };

      const result = validateHook(hook);

      expect(result.valid).to.be.true;
      expect(result.errors).to.have.length(0);
    });

    it('requires name', () => {
      const hook: Partial<Hook> = {
        event: 'ticket.created',
        actions: [{ type: 'log', message: 'Test' }],
      };

      const result = validateHook(hook);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Hook must have a name');
    });

    it('requires valid event', () => {
      const hook: Partial<Hook> = {
        name: 'Invalid Event Hook',
        event: 'invalid.event' as any,
        actions: [{ type: 'log', message: 'Test' }],
      };

      const result = validateHook(hook);

      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('Invalid event name'))).to.be.true;
    });

    it('requires at least one action', () => {
      const hook: Partial<Hook> = {
        name: 'No Actions Hook',
        event: 'ticket.created',
        actions: [],
      };

      const result = validateHook(hook);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Hook must have at least one action');
    });

    it('validates shell action requires command', () => {
      const hook: Partial<Hook> = {
        name: 'Invalid Shell Hook',
        event: 'ticket.created',
        actions: [{ type: 'shell' } as any],
      };

      const result = validateHook(hook);

      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('Shell action must have a command'))).to.be.true;
    });
  });

  // ==========================================================================
  // Template Generation Tests
  // ==========================================================================

  describe('Template Generation', () => {
    it('generates valid YAML template', () => {
      const template = generateHooksTemplate();

      expect(template).to.include('version:');
      expect(template).to.include('hooks:');
      expect(template).to.include('auto_spawn_ready');
      expect(template).to.include('ticket.moved');
    });
  });
});

// ==========================================================================
// Helper Functions
// ==========================================================================

function createMockTicket(): Ticket {
  return {
    id: 'TEST-001',
    title: 'Test Ticket',
    description: 'Test description',
    status: 'backlog' as TicketStatus,
    column: 'Backlog',
    priority: 'MEDIUM',
    category: 'test',
    subtasks: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
