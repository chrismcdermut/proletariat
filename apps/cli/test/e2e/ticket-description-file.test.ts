import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  exec,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Tests for --description-file flag on ticket create (TKT-933).
 *
 * Tests:
 * - Reading description from a markdown file
 * - Mutual exclusion with --description flag
 * - Error handling for missing/unreadable files
 */
describe('ticket create --description-file', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('ticket-desc-file-');

    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project', description: 'Test project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  it('should create ticket with description read from a file', () => {
    const descFile = path.join(env.testDir, 'desc.md');
    fs.writeFileSync(descFile, '## Overview\n\nThis is a file-based description.\n\n## Details\n\nMore info here.', 'utf-8');

    const output = exec(`ticket create --title "File desc ticket" --column Backlog --description-file "${descFile}"`);

    expect(output).to.contain('Created ticket');
    expect(output).to.contain('File desc ticket');

    // Verify description is stored in database
    const ticket = db.prepare('SELECT description FROM pmo_tickets WHERE title = ?').get('File desc ticket') as { description: string } | undefined;
    expect(ticket).to.not.be.undefined;
    expect(ticket!.description).to.contain('This is a file-based description.');
    expect(ticket!.description).to.contain('## Overview');
  });

  it('should error when --description and --description-file are both provided', () => {
    const descFile = path.join(env.testDir, 'desc2.md');
    fs.writeFileSync(descFile, 'File content', 'utf-8');

    const output = exec(`ticket create --title "Conflict test" --column Backlog --description "inline" --description-file "${descFile}"`);

    // oclif exclusive flag validation should produce an error
    expect(output.toLowerCase()).to.match(/cannot also be provided|exclusive|mutually exclusive/i);
  });

  it('should error when description file does not exist', () => {
    const output = exec('ticket create --title "Missing file" --column Backlog --description-file "/nonexistent/path.md"');

    expect(output.toLowerCase()).to.contain('failed to read description file');
  });

  it('should use short flag -D for description-file', () => {
    const descFile = path.join(env.testDir, 'short-flag.md');
    fs.writeFileSync(descFile, 'Short flag description content', 'utf-8');

    const output = exec(`ticket create --title "Short flag ticket" --column Backlog -D "${descFile}"`);

    expect(output).to.contain('Created ticket');

    const ticket = db.prepare('SELECT description FROM pmo_tickets WHERE title = ?').get('Short flag ticket') as { description: string } | undefined;
    expect(ticket).to.not.be.undefined;
    expect(ticket!.description).to.contain('Short flag description content');
  });

  it('should preserve multi-line markdown content from file', () => {
    const descFile = path.join(env.testDir, 'multiline.md');
    const content = [
      '## What',
      '',
      'Implement the feature.',
      '',
      '## Done when',
      '',
      '- [ ] Tests pass',
      '- [ ] Code reviewed',
      '',
      '## Context',
      '',
      'See `src/lib/feature.ts` for details.',
    ].join('\n');
    fs.writeFileSync(descFile, content, 'utf-8');

    const output = exec(`ticket create --title "Multiline test" --column Backlog --description-file "${descFile}"`);

    expect(output).to.contain('Created ticket');

    const ticket = db.prepare('SELECT description FROM pmo_tickets WHERE title = ?').get('Multiline test') as { description: string } | undefined;
    expect(ticket).to.not.be.undefined;
    expect(ticket!.description).to.contain('## What');
    expect(ticket!.description).to.contain('Tests pass');
    expect(ticket!.description).to.contain('## Context');
  });
});
