import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  validateIssueEnvelope,
  validateOrThrow,
  mapToSpawnContext,
  ExternalIssueError,
  ISSUE_SOURCES,
  LinearIssueAdapter,
  JiraIssueAdapter,
  ExternalExecutionMappingStore,
  type IssueEnvelope,
} from '../../src/lib/external-issues/index.js';

/**
 * Factory for creating a valid IssueEnvelope for tests.
 * Override any field by passing partial data.
 */
function makeEnvelope(overrides: Partial<IssueEnvelope> = {}): IssueEnvelope {
  return {
    source: 'linear',
    external_id: 'abc-123-def',
    external_key: 'ENG-42',
    title: 'Fix login redirect',
    description: 'Users are redirected to the wrong page after login.',
    labels: ['bug', 'auth'],
    priority: 'P1',
    status: 'In Progress',
    url: 'https://linear.app/team/issue/ENG-42',
    project_key: 'ENG',
    assignee: 'alice',
    raw: { id: 'abc-123-def', state: { name: 'In Progress' } },
    ...overrides,
  };
}

describe('External Issues', () => {
  // ===========================================================================
  // IssueEnvelope Validation
  // ===========================================================================
  describe('validateIssueEnvelope', () => {
    it('accepts a valid Linear envelope', () => {
      const result = validateIssueEnvelope(makeEnvelope());
      expect(result.valid).to.equal(true);
      if (result.valid) {
        expect(result.envelope.source).to.equal('linear');
        expect(result.envelope.external_key).to.equal('ENG-42');
      }
    });

    it('accepts a valid Jira envelope', () => {
      const result = validateIssueEnvelope(
        makeEnvelope({
          source: 'jira',
          external_id: '10001',
          external_key: 'PROJ-456',
          url: 'https://myorg.atlassian.net/browse/PROJ-456',
          project_key: 'PROJ',
          raw: { id: '10001', fields: { summary: 'Fix login' } },
        })
      );
      expect(result.valid).to.equal(true);
      if (result.valid) {
        expect(result.envelope.source).to.equal('jira');
      }
    });

    it('accepts envelope with null priority', () => {
      const result = validateIssueEnvelope(makeEnvelope({ priority: null }));
      expect(result.valid).to.equal(true);
      if (result.valid) {
        expect(result.envelope.priority).to.be.null;
      }
    });

    it('accepts envelope with null assignee', () => {
      const result = validateIssueEnvelope(makeEnvelope({ assignee: null }));
      expect(result.valid).to.equal(true);
      if (result.valid) {
        expect(result.envelope.assignee).to.be.null;
      }
    });

    it('accepts envelope with empty description', () => {
      const result = validateIssueEnvelope(makeEnvelope({ description: '' }));
      expect(result.valid).to.equal(true);
    });

    it('accepts envelope with empty labels array', () => {
      const result = validateIssueEnvelope(makeEnvelope({ labels: [] }));
      expect(result.valid).to.equal(true);
    });

    // =========================================================================
    // Missing Fields
    // =========================================================================
    describe('missing fields', () => {
      it('rejects null input', () => {
        const result = validateIssueEnvelope(null);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors).to.have.length(1);
          expect(result.errors[0].code).to.equal('INVALID_FIELD_TYPE');
          expect(result.errors[0].field).to.equal('(root)');
        }
      });

      it('rejects non-object input', () => {
        const result = validateIssueEnvelope('not-an-object');
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors[0].code).to.equal('INVALID_FIELD_TYPE');
        }
      });

      it('rejects missing source', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).source;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'source' && e.code === 'MISSING_FIELD')).to.be.true;
        }
      });

      it('rejects missing external_id', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).external_id;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'external_id')).to.be.true;
        }
      });

      it('rejects missing title', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).title;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'title')).to.be.true;
        }
      });

      it('rejects missing description', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).description;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'description')).to.be.true;
        }
      });

      it('rejects missing labels', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).labels;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'labels')).to.be.true;
        }
      });

      it('rejects missing raw', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).raw;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'raw')).to.be.true;
        }
      });

      it('rejects missing priority (undefined, not null)', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).priority;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'priority')).to.be.true;
        }
      });

      it('rejects missing assignee (undefined, not null)', () => {
        const data = makeEnvelope();
        delete (data as unknown as Record<string, unknown>).assignee;
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'assignee')).to.be.true;
        }
      });

      it('collects all missing field errors at once', () => {
        const result = validateIssueEnvelope({});
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          // Should have errors for: source, external_id, external_key, title,
          // description, labels, priority, assignee, status, url, project_key, raw
          expect(result.errors.length).to.be.greaterThanOrEqual(10);
        }
      });
    });

    // =========================================================================
    // Invalid Types
    // =========================================================================
    describe('invalid field types', () => {
      it('rejects invalid source value', () => {
        const result = validateIssueEnvelope(
          makeEnvelope({ source: 'github' as 'linear' })
        );
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors[0].code).to.equal('INVALID_SOURCE');
          expect(result.errors[0].message).to.include('github');
        }
      });

      it('rejects non-string source', () => {
        const data = { ...makeEnvelope(), source: 42 };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'source' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });

      it('rejects non-string title', () => {
        const data = { ...makeEnvelope(), title: 123 };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'title' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });

      it('rejects non-array labels', () => {
        const data = { ...makeEnvelope(), labels: 'bug' };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'labels' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });

      it('rejects non-string items in labels array', () => {
        const data = { ...makeEnvelope(), labels: ['bug', 42, 'auth'] };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'labels[1]')).to.be.true;
        }
      });

      it('rejects non-string, non-null priority', () => {
        const data = { ...makeEnvelope(), priority: 42 };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'priority' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });

      it('rejects priority outside canonical P0-P3 scale', () => {
        const data = { ...makeEnvelope(), priority: 'Urgent' };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'priority' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });

      it('rejects non-string, non-null item_type when provided', () => {
        const data = { ...makeEnvelope(), item_type: 123 };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'item_type' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });

      it('rejects array as raw payload', () => {
        const data = { ...makeEnvelope(), raw: [1, 2, 3] };
        const result = validateIssueEnvelope(data);
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'raw' && e.code === 'INVALID_FIELD_TYPE')).to.be.true;
        }
      });
    });

    // =========================================================================
    // Empty String Fields
    // =========================================================================
    describe('empty string fields', () => {
      it('rejects empty external_id', () => {
        const result = validateIssueEnvelope(makeEnvelope({ external_id: '' }));
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'external_id' && e.code === 'EMPTY_FIELD')).to.be.true;
        }
      });

      it('rejects whitespace-only title', () => {
        const result = validateIssueEnvelope(makeEnvelope({ title: '   ' }));
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'title' && e.code === 'EMPTY_FIELD')).to.be.true;
        }
      });

      it('rejects empty status', () => {
        const result = validateIssueEnvelope(makeEnvelope({ status: '' }));
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'status' && e.code === 'EMPTY_FIELD')).to.be.true;
        }
      });

      it('rejects empty item_type when provided', () => {
        const result = validateIssueEnvelope(makeEnvelope({ item_type: '  ' }));
        expect(result.valid).to.equal(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.field === 'item_type' && e.code === 'EMPTY_FIELD')).to.be.true;
        }
      });
    });
  });

  // ===========================================================================
  // validateOrThrow
  // ===========================================================================
  describe('validateOrThrow', () => {
    it('returns valid envelope on success', () => {
      const envelope = validateOrThrow(makeEnvelope());
      expect(envelope.source).to.equal('linear');
      expect(envelope.title).to.equal('Fix login redirect');
    });

    it('throws ExternalIssueError on failure', () => {
      try {
        validateOrThrow({});
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(ExternalIssueError);
        const issueErr = err as ExternalIssueError;
        expect(issueErr.code).to.equal('VALIDATION_FAILED');
        expect(issueErr.validationErrors).to.be.an('array');
        expect(issueErr.validationErrors!.length).to.be.greaterThan(0);
      }
    });

    it('error message lists invalid fields', () => {
      try {
        validateOrThrow({ source: 'linear' });
        expect.fail('should have thrown');
      } catch (err) {
        const issueErr = err as ExternalIssueError;
        expect(issueErr.message).to.include('external_id');
        expect(issueErr.message).to.include('title');
      }
    });
  });

  // ===========================================================================
  // ISSUE_SOURCES Constant
  // ===========================================================================
  describe('ISSUE_SOURCES', () => {
    it('contains currently supported sources', () => {
      expect(ISSUE_SOURCES).to.include('linear');
      expect(ISSUE_SOURCES).to.include('jira');
    });

    it('has exactly 4 known sources', () => {
      expect(ISSUE_SOURCES).to.have.length(4);
    });
  });

  // ===========================================================================
  // ExternalIssueError
  // ===========================================================================
  describe('ExternalIssueError', () => {
    it('has correct name and code', () => {
      const err = new ExternalIssueError('FETCH_FAILED', 'Could not fetch issue', 'linear');
      expect(err.name).to.equal('ExternalIssueError');
      expect(err.code).to.equal('FETCH_FAILED');
      expect(err.source).to.equal('linear');
      expect(err.message).to.equal('Could not fetch issue');
    });

    it('can carry validation errors', () => {
      const err = new ExternalIssueError(
        'VALIDATION_FAILED',
        'Invalid',
        'jira',
        [{ code: 'MISSING_FIELD', field: 'title', message: 'title is required' }]
      );
      expect(err.validationErrors).to.have.length(1);
      expect(err.validationErrors![0].field).to.equal('title');
    });

    it('is an instance of Error', () => {
      const err = new ExternalIssueError('SOURCE_NOT_SUPPORTED', 'Unsupported');
      expect(err).to.be.instanceOf(Error);
    });
  });

  // ===========================================================================
  // Adapters
  // ===========================================================================
  describe('adapters', () => {
    describe('LinearIssueAdapter', () => {
      it('normalizes a Linear issue payload', () => {
        const adapter = new LinearIssueAdapter();
        const raw = {
          id: 'lin-id-1',
          identifier: 'ENG-77',
          title: 'Handle 500 in auth callback',
          description: 'Improve error handling in callback path',
          labels: [{ name: 'bug' }, 'auth'],
          priority: 2,
          state: { name: 'Todo' },
          url: 'https://linear.app/proletariat/issue/ENG-77',
          team: { key: 'ENG' },
          assignee: { name: 'Casey' },
        };

        const envelope = adapter.normalize(raw);
        expect(envelope.source).to.equal('linear');
        expect(envelope.external_id).to.equal('lin-id-1');
        expect(envelope.external_key).to.equal('ENG-77');
        expect(envelope.priority).to.equal('P1');
        expect(envelope.project_key).to.equal('ENG');
        expect(envelope.labels).to.deep.equal(['bug', 'auth']);
        expect(envelope.raw).to.deep.equal(raw);
      });

      it('throws typed normalize errors for missing required fields', () => {
        const adapter = new LinearIssueAdapter();
        try {
          adapter.normalize({ identifier: 'ENG-77' });
          expect.fail('should have thrown');
        } catch (err) {
          expect(err).to.be.instanceOf(ExternalIssueError);
          const issueErr = err as ExternalIssueError;
          expect(issueErr.code).to.equal('NORMALIZE_FAILED');
          expect(issueErr.source).to.equal('linear');
          expect(issueErr.validationErrors?.some((e) => e.field === 'external_id')).to.equal(true);
        }
      });

      it('throws typed fetch errors when no fetcher is configured', async () => {
        const adapter = new LinearIssueAdapter();
        try {
          await adapter.fetchByKey('ENG-77');
          expect.fail('should have thrown');
        } catch (err) {
          expect(err).to.be.instanceOf(ExternalIssueError);
          const issueErr = err as ExternalIssueError;
          expect(issueErr.code).to.equal('FETCH_FAILED');
          expect(issueErr.source).to.equal('linear');
        }
      });

      it('persists and reads mapping records without PMO ticket dependency', () => {
        const adapter = new LinearIssueAdapter();
        const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-adapter-map-'));
        const db = new Database(path.join(testDir, 'test.db'));
        const store = new ExternalExecutionMappingStore(db);

        try {
          const envelope = adapter.normalize({
            id: 'lin-id-2',
            identifier: 'ENG-100',
            title: 'Tighten auth checks',
            description: 'Improve validation',
            labels: ['security'],
            priority: 1,
            state: { name: 'In Progress' },
            url: 'https://linear.app/proletariat/issue/ENG-100',
            team: { key: 'ENG' },
          });

          adapter.persistMapping(store, envelope, { executionId: 'WORK-12345678' });
          const byExternal = adapter.readMappingByExternalId(store, 'lin-id-2');
          const byExecution = adapter.readMappingsByExecutionId(store, 'WORK-12345678');

          expect(byExternal).to.not.equal(null);
          expect(byExternal!.provider).to.equal('linear');
          expect(byExecution).to.have.length(1);
          expect(byExecution[0].externalId).to.equal('lin-id-2');
        } finally {
          db.close();
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      });
    });

    describe('JiraIssueAdapter', () => {
      it('normalizes a Jira issue payload', () => {
        const adapter = new JiraIssueAdapter();
        const raw = {
          id: '10001',
          key: 'PROJ-456',
          self: 'https://myorg.atlassian.net/rest/api/3/issue/10001',
          fields: {
            summary: 'Fix webhook retries',
            description: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Retry transient failures' }],
                },
              ],
            },
            labels: ['backend', 'webhook'],
            priority: { name: 'High' },
            status: { name: 'In Progress' },
            project: { key: 'PROJ' },
            issuetype: { name: 'Task' },
            assignee: { displayName: 'Jordan' },
          },
        };

        const envelope = adapter.normalize(raw);
        expect(envelope.source).to.equal('jira');
        expect(envelope.external_id).to.equal('10001');
        expect(envelope.external_key).to.equal('PROJ-456');
        expect(envelope.url).to.equal('https://myorg.atlassian.net/browse/PROJ-456');
        expect(envelope.priority).to.equal('P1');
        expect(envelope.item_type).to.equal('Task');
        expect(envelope.description).to.include('Retry transient failures');
        expect(envelope.raw).to.deep.equal(raw);
      });

      it('throws typed normalize errors for missing required fields', () => {
        const adapter = new JiraIssueAdapter();
        try {
          adapter.normalize({ id: '10001', fields: { summary: 'x' } });
          expect.fail('should have thrown');
        } catch (err) {
          expect(err).to.be.instanceOf(ExternalIssueError);
          const issueErr = err as ExternalIssueError;
          expect(issueErr.code).to.equal('NORMALIZE_FAILED');
          expect(issueErr.source).to.equal('jira');
          expect(issueErr.validationErrors?.some((e) => e.field === 'external_key')).to.equal(true);
        }
      });

      it('uses configured fetcher and normalizes query results', async () => {
        const adapter = new JiraIssueAdapter({
          fetchByQuery: async () => [
            {
              id: '10002',
              key: 'PROJ-457',
              self: 'https://myorg.atlassian.net/rest/api/3/issue/10002',
              fields: {
                summary: 'Document rollback flow',
                description: 'Add docs for rollback process',
                labels: ['docs'],
                priority: { name: 'Low' },
                status: { name: 'Todo' },
                project: { key: 'PROJ' },
                assignee: null,
              },
            },
          ],
        });

        const envelopes = await adapter.fetchByQuery({ jql: 'project=PROJ' });
        expect(envelopes).to.have.length(1);
        expect(envelopes[0].external_key).to.equal('PROJ-457');
        expect(envelopes[0].priority).to.equal('P3');
      });

      it('persists and reads mapping records without PMO ticket dependency', () => {
        const adapter = new JiraIssueAdapter();
        const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-adapter-map-'));
        const db = new Database(path.join(testDir, 'test.db'));
        const store = new ExternalExecutionMappingStore(db);

        try {
          const envelope = adapter.normalize({
            id: '20002',
            key: 'PROJ-900',
            self: 'https://myorg.atlassian.net/rest/api/3/issue/20002',
            fields: {
              summary: 'Refine deployment checks',
              description: 'Improve release validation',
              labels: ['release'],
              priority: { name: 'Medium' },
              status: { name: 'Todo' },
              project: { key: 'PROJ' },
            },
          });

          adapter.persistMapping(store, envelope, { executionId: 'WORK-87654321' });
          const byExternal = adapter.readMappingByExternalId(store, '20002');
          const byExecution = adapter.readMappingsByExecutionId(store, 'WORK-87654321');

          expect(byExternal).to.not.equal(null);
          expect(byExternal!.provider).to.equal('jira');
          expect(byExecution).to.have.length(1);
          expect(byExecution[0].externalKey).to.equal('PROJ-900');
        } finally {
          db.close();
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      });
    });
  });

  // ===========================================================================
  // mapToSpawnContext
  // ===========================================================================
  describe('mapToSpawnContext', () => {
    it('throws validation error for invalid input', () => {
      try {
        mapToSpawnContext({ source: 'linear' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(ExternalIssueError);
        const issueErr = err as ExternalIssueError;
        expect(issueErr.code).to.equal('VALIDATION_FAILED');
      }
    });

    it('produces prompt with title as heading', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).to.include('# Fix login redirect');
    });

    it('includes source and external key in prompt', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).to.include('linear');
      expect(ctx.prompt).to.include('ENG-42');
    });

    it('includes status in prompt', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).to.include('In Progress');
    });

    it('includes item type in prompt when provided', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ item_type: 'ticket' }));
      expect(ctx.prompt).to.include('**Item Type:** ticket');
    });

    it('omits item type line when not provided', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).not.to.include('**Item Type:**');
    });

    it('includes priority when set', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ priority: 'P0' }));
      expect(ctx.prompt).to.include('P0');
    });

    it('omits priority line when null', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ priority: null }));
      expect(ctx.prompt).not.to.include('**Priority:**');
    });

    it('includes assignee when set', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ assignee: 'bob' }));
      expect(ctx.prompt).to.include('bob');
    });

    it('omits assignee line when null', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ assignee: null }));
      expect(ctx.prompt).not.to.include('**Assignee:**');
    });

    it('includes project key in prompt', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).to.include('ENG');
    });

    it('includes labels when present', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ labels: ['bug', 'auth'] }));
      expect(ctx.prompt).to.include('bug');
      expect(ctx.prompt).to.include('auth');
    });

    it('omits labels line when empty', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ labels: [] }));
      expect(ctx.prompt).not.to.include('**Labels:**');
    });

    it('includes URL in prompt', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).to.include('https://linear.app/team/issue/ENG-42');
    });

    it('includes description in prompt', () => {
      const ctx = mapToSpawnContext(makeEnvelope());
      expect(ctx.prompt).to.include('## Description');
      expect(ctx.prompt).to.include('Users are redirected to the wrong page');
    });

    it('omits description section when empty', () => {
      const ctx = mapToSpawnContext(makeEnvelope({ description: '' }));
      expect(ctx.prompt).not.to.include('## Description');
    });

    // =========================================================================
    // Metadata
    // =========================================================================
    describe('metadata', () => {
      it('includes external_source', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata['external_source']).to.equal('linear');
      });

      it('includes external_id', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata['external_id']).to.equal('abc-123-def');
      });

      it('includes external_key', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata['external_key']).to.equal('ENG-42');
      });

      it('includes external_url', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata['external_url']).to.equal('https://linear.app/team/issue/ENG-42');
      });

      it('includes external_project', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata['external_project']).to.equal('ENG');
      });

      it('includes external_status', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata['external_status']).to.equal('In Progress');
      });

      it('includes external_priority when set', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ priority: 'P1' }));
        expect(ctx.metadata['external_priority']).to.equal('P1');
      });

      it('omits external_priority when null', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ priority: null }));
        expect(ctx.metadata).not.to.have.property('external_priority');
      });

      it('includes external_assignee when set', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ assignee: 'alice' }));
        expect(ctx.metadata['external_assignee']).to.equal('alice');
      });

      it('omits external_assignee when null', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ assignee: null }));
        expect(ctx.metadata).not.to.have.property('external_assignee');
      });

      it('includes external_item_type when set', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ item_type: 'issue' }));
        expect(ctx.metadata['external_item_type']).to.equal('issue');
      });

      it('omits external_item_type when not set', () => {
        const ctx = mapToSpawnContext(makeEnvelope());
        expect(ctx.metadata).not.to.have.property('external_item_type');
      });

      it('includes external_labels as comma-separated string', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ labels: ['bug', 'auth', 'urgent'] }));
        expect(ctx.metadata['external_labels']).to.equal('bug,auth,urgent');
      });

      it('omits external_labels when empty', () => {
        const ctx = mapToSpawnContext(makeEnvelope({ labels: [] }));
        expect(ctx.metadata).not.to.have.property('external_labels');
      });
    });

    // =========================================================================
    // Determinism
    // =========================================================================
    describe('determinism', () => {
      it('produces identical output for identical input', () => {
        const envelope = makeEnvelope();
        const ctx1 = mapToSpawnContext(envelope);
        const ctx2 = mapToSpawnContext(envelope);
        expect(ctx1.prompt).to.equal(ctx2.prompt);
        expect(ctx1.metadata).to.deep.equal(ctx2.metadata);
      });

      it('produces different output for different input', () => {
        const ctx1 = mapToSpawnContext(makeEnvelope({ title: 'Issue A' }));
        const ctx2 = mapToSpawnContext(makeEnvelope({ title: 'Issue B' }));
        expect(ctx1.prompt).not.to.equal(ctx2.prompt);
      });
    });

    // =========================================================================
    // Jira source
    // =========================================================================
    it('works with Jira envelope', () => {
      const envelope = makeEnvelope({
        source: 'jira',
        external_id: '10001',
        external_key: 'PROJ-456',
        url: 'https://myorg.atlassian.net/browse/PROJ-456',
        project_key: 'PROJ',
      });
      const ctx = mapToSpawnContext(envelope);
      expect(ctx.prompt).to.include('jira');
      expect(ctx.prompt).to.include('PROJ-456');
      expect(ctx.metadata['external_source']).to.equal('jira');
      expect(ctx.metadata['external_project']).to.equal('PROJ');
    });
  });
});
