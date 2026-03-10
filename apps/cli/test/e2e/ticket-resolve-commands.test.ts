import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  execInProcess,
  cleanupTestEnvironment,
  createHQConfig,
  setupProductionSchemaOnDb,
  createTestProject,
  createTestTicket,
  createPMODirectories,
  createTemplateTestEnvironment,
  type TestEnvironment,
  type TemplateTestEnvironment,
} from './test-helpers.js';
import { PMO_TABLES } from '../../src/lib/pmo/schema.js';

const T = PMO_TABLES;

describe('Ticket Resolve Commands E2E Tests', () => {
  let template: TemplateTestEnvironment;
  let env: TestEnvironment;
  let db: Database.Database;
  let projectId: string;

  before(() => {
    template = createTemplateTestEnvironment('ticket-resolve-e2e-', (db, pmoPath) => {
      setupProductionSchemaOnDb(db, pmoPath);
      createTestProject(db, { id: 'test-project', name: 'Test Project' });
    });
  });

  beforeEach(() => {
    ({ env, db } = template.createInstance());
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath);
    projectId = 'test-project';
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  after(() => {
    template.cleanup();
  });

  describe('prlt ticket resolve', () => {
    it('should show error when no needs-clarification tickets exist', async () => {
      createTestTicket(db, projectId, {
        id: 'TKT-001',
        title: 'Normal ticket',
        description: 'No questions here',
      });

      const output = await execInProcess('ticket resolve --json');
      expect(output).to.contain('No tickets need clarification');
    });

    it('should output questions in JSON mode for ticket with questions', async () => {
      const description = `## Description
Some context here.

**Q1:** Should we use REST or GraphQL?
**Q2:** What is the expected timeout?`;

      const ticketId = createTestTicket(db, projectId, {
        id: 'TKT-002',
        title: 'Ticket with questions',
        description,
      });

      // Add needs-clarification label
      db.prepare(`UPDATE ${T.tickets} SET labels = ? WHERE id = ?`).run(
        JSON.stringify(['needs-clarification']),
        ticketId
      );

      const output = await execInProcess(`ticket resolve ${ticketId} --json`);
      const parsed = JSON.parse(output);

      expect(parsed.type).to.equal('success');
      expect(parsed.result.ticketId).to.equal(ticketId);
      expect(parsed.result.questions).to.have.lengthOf(2);
      expect(parsed.result.questions[0].number).to.equal(1);
      expect(parsed.result.questions[0].text).to.equal('Should we use REST or GraphQL?');
      expect(parsed.result.questions[1].number).to.equal(2);
      expect(parsed.result.questions[1].text).to.equal('What is the expected timeout?');
    });

    it('should show message when ticket has no questions', async () => {
      const ticketId = createTestTicket(db, projectId, {
        id: 'TKT-003',
        title: 'Ticket without questions',
        description: 'Just a regular description with no Q markers.',
      });

      // Add needs-clarification label
      db.prepare(`UPDATE ${T.tickets} SET labels = ? WHERE id = ?`).run(
        JSON.stringify(['needs-clarification']),
        ticketId
      );

      const output = await execInProcess(`ticket resolve ${ticketId}`);
      expect(output).to.contain('No questions found');
    });

    it('should show message when all questions are already answered', async () => {
      const description = `**Q1:** Should we use REST?
**A1:** Use REST for simplicity.`;

      const ticketId = createTestTicket(db, projectId, {
        id: 'TKT-004',
        title: 'Already resolved',
        description,
      });

      const output = await execInProcess(`ticket resolve ${ticketId}`);
      expect(output).to.contain('already answered');
    });

    it('should report ticket not found error', async () => {
      const output = await execInProcess('ticket resolve NON-EXISTENT --json');
      expect(output).to.contain('not found');
    });

    it('should list only needs-clarification tickets in JSON mode picker', async () => {
      // Create a ticket with the label
      const ticketId = createTestTicket(db, projectId, {
        id: 'TKT-005',
        title: 'Needs clarification ticket',
        description: '**Q1:** What about this?',
      });
      db.prepare(`UPDATE ${T.tickets} SET labels = ? WHERE id = ?`).run(
        JSON.stringify(['needs-clarification']),
        ticketId
      );

      // Create a normal ticket without the label
      createTestTicket(db, projectId, {
        id: 'TKT-006',
        title: 'Normal ticket',
        description: 'No questions',
      });

      const output = await execInProcess('ticket resolve --json');
      const parsed = JSON.parse(output);

      // Should show the picker prompt
      expect(parsed.type).to.equal('prompt');
      expect(parsed.prompt.choices).to.have.lengthOf(1);
      expect(parsed.prompt.choices[0].value).to.equal(ticketId);
    });
  });

  describe('resolve action in actions list', () => {
    it('should include resolve action in builtin actions', () => {
      const action = db.prepare(`SELECT * FROM ${T.actions} WHERE id = 'resolve'`).get() as { id: string; name: string; description: string } | undefined;
      expect(action).to.not.be.undefined;
      expect(action!.name).to.equal('Resolve');
      expect(action!.description).to.contain('ambiguity');
    });
  });

  describe('groom action question format', () => {
    it('should reference Q1/Q2 format in groom prompt', () => {
      const action = db.prepare(`SELECT prompt FROM ${T.actions} WHERE id = 'groom'`).get() as { prompt: string } | undefined;
      expect(action).to.not.be.undefined;
      expect(action!.prompt).to.contain('**Q1:**');
      expect(action!.prompt).to.contain('needs-clarification');
      expect(action!.prompt).to.contain('prlt ticket resolve');
    });
  });
});
