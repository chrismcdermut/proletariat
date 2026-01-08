import { expect } from 'chai';

// Import the format functions directly
// Since COMMIT_FORMATS is exported, we can test the format functions
import { COMMIT_FORMATS, DEFAULT_COMMIT_FORMAT } from '../../src/commands/commit.js';

describe('Commit Formats Unit Tests', () => {
  const fullContext = {
    type: 'feat',
    ticketId: 'TKT-123',
    agent: 'bezos',
    message: 'add user authentication',
  };

  const noTicketContext = {
    type: 'feat',
    ticketId: undefined,
    agent: 'bezos',
    message: 'add user authentication',
  };

  const noAgentContext = {
    type: 'feat',
    ticketId: 'TKT-123',
    agent: undefined,
    message: 'add user authentication',
  };

  const minimalContext = {
    type: 'feat',
    ticketId: undefined,
    agent: undefined,
    message: 'add user authentication',
  };

  describe('DEFAULT_COMMIT_FORMAT', () => {
    it('should be conventional', () => {
      expect(DEFAULT_COMMIT_FORMAT).to.equal('conventional');
    });
  });

  describe('COMMIT_FORMATS', () => {
    it('should have all expected formats', () => {
      const expectedFormats = [
        'conventional',
        'full-context',
        'ticket-first',
        'with-agent',
        'ticket-suffix',
        'ticket-only',
        'simple',
      ];

      for (const format of expectedFormats) {
        expect(COMMIT_FORMATS).to.have.property(format);
      }
    });
  });

  describe('conventional format', () => {
    const format = COMMIT_FORMATS['conventional'];

    it('should have description', () => {
      expect(format.description).to.contain('Conventional');
    });

    it('should format with ticket: type(TKT-ID): message', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('feat(TKT-123): add user authentication');
    });

    it('should format without ticket: type: message', () => {
      const result = format.format(noTicketContext);
      expect(result).to.equal('feat: add user authentication');
    });
  });

  describe('full-context format', () => {
    const format = COMMIT_FORMATS['full-context'];

    it('should format with ticket and agent: TKT-ID/type/agent: message', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('TKT-123/feat/bezos: add user authentication');
    });

    it('should format with ticket only: TKT-ID/type: message', () => {
      const result = format.format(noAgentContext);
      expect(result).to.equal('TKT-123/feat: add user authentication');
    });

    it('should format without ticket: type: message', () => {
      const result = format.format(minimalContext);
      expect(result).to.equal('feat: add user authentication');
    });
  });

  describe('ticket-first format', () => {
    const format = COMMIT_FORMATS['ticket-first'];

    it('should format with ticket: TKT-ID: type: message', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('TKT-123: feat: add user authentication');
    });

    it('should format without ticket: type: message', () => {
      const result = format.format(noTicketContext);
      expect(result).to.equal('feat: add user authentication');
    });
  });

  describe('with-agent format', () => {
    const format = COMMIT_FORMATS['with-agent'];

    it('should format with ticket and agent: TKT-ID/agent: message', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('TKT-123/bezos: add user authentication');
    });

    it('should format with ticket only: TKT-ID: message', () => {
      const result = format.format(noAgentContext);
      expect(result).to.equal('TKT-123: add user authentication');
    });

    it('should format without ticket: just message', () => {
      const result = format.format(minimalContext);
      expect(result).to.equal('add user authentication');
    });
  });

  describe('ticket-suffix format', () => {
    const format = COMMIT_FORMATS['ticket-suffix'];

    it('should format with ticket: type: message [TKT-ID]', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('feat: add user authentication [TKT-123]');
    });

    it('should format without ticket: type: message', () => {
      const result = format.format(noTicketContext);
      expect(result).to.equal('feat: add user authentication');
    });
  });

  describe('ticket-only format', () => {
    const format = COMMIT_FORMATS['ticket-only'];

    it('should format with ticket: TKT-ID: message', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('TKT-123: add user authentication');
    });

    it('should format without ticket: just message', () => {
      const result = format.format(noTicketContext);
      expect(result).to.equal('add user authentication');
    });
  });

  describe('simple format', () => {
    const format = COMMIT_FORMATS['simple'];

    it('should always format as type: message (no ticket)', () => {
      const result = format.format(fullContext);
      expect(result).to.equal('feat: add user authentication');
    });

    it('should format same way without ticket', () => {
      const result = format.format(noTicketContext);
      expect(result).to.equal('feat: add user authentication');
    });
  });

  describe('all formats with different commit types', () => {
    const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

    for (const type of types) {
      it(`should work with type: ${type}`, () => {
        const ctx = { ...fullContext, type };
        const result = COMMIT_FORMATS['conventional'].format(ctx);
        expect(result).to.contain(type);
        expect(result).to.contain('TKT-123');
      });
    }
  });
});
