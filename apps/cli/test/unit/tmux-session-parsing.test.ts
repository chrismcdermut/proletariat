import { expect } from 'chai';

/**
 * Unit tests for tmux session name parsing (TKT-655)
 * Tests the session name parsing logic used by getActiveTmuxSessions()
 */
describe('Tmux Session Parsing (TKT-655)', () => {
  /**
   * Parse a session name in the format: {ticketId}-{action}-{agent}
   * Example: TKT-123-implement-bold-bezos-1 -> ticketId: TKT-123, agent: bold-bezos-1
   */
  function parseSessionName(name: string): { name: string; ticketId: string; agent: string } {
    const parts = name.split('-');
    if (parts.length >= 3) {
      // TKT-123-implement-bold-bezos-1 -> ticketId: TKT-123, agent: bold-bezos-1
      const ticketId = parts.slice(0, 2).join('-');
      const agent = parts.slice(3).join('-');
      return { name, ticketId, agent };
    }
    return { name, ticketId: '', agent: '' };
  }

  describe('parseSessionName()', () => {
    it('should parse standard session name format', () => {
      const result = parseSessionName('TKT-123-implement-bold-bezos');

      expect(result.name).to.equal('TKT-123-implement-bold-bezos');
      expect(result.ticketId).to.equal('TKT-123');
      expect(result.agent).to.equal('bold-bezos');
    });

    it('should parse session name with numbered agent suffix', () => {
      const result = parseSessionName('TKT-456-implement-keen-musk-2');

      expect(result.name).to.equal('TKT-456-implement-keen-musk-2');
      expect(result.ticketId).to.equal('TKT-456');
      expect(result.agent).to.equal('keen-musk-2');
    });

    it('should parse session name with long ticket number', () => {
      const result = parseSessionName('TKT-1234-fix-some-agent');

      expect(result.ticketId).to.equal('TKT-1234');
      expect(result.agent).to.equal('some-agent');
    });

    it('should parse session name with multi-part agent name', () => {
      const result = parseSessionName('TKT-789-research-sonic-wojcicki-1');

      expect(result.ticketId).to.equal('TKT-789');
      expect(result.agent).to.equal('sonic-wojcicki-1');
    });

    it('should return empty strings for invalid format', () => {
      const result = parseSessionName('invalid-name');

      expect(result.name).to.equal('invalid-name');
      expect(result.ticketId).to.equal('');
      expect(result.agent).to.equal('');
    });

    it('should return empty strings for too short format', () => {
      const result = parseSessionName('TKT-123');

      expect(result.name).to.equal('TKT-123');
      expect(result.ticketId).to.equal('');
      expect(result.agent).to.equal('');
    });
  });

  describe('Session filtering', () => {
    it('should filter sessions by agent name', () => {
      const sessions = [
        { name: 'TKT-123-implement-bold-bezos', ticketId: 'TKT-123', agent: 'bold-bezos' },
        { name: 'TKT-456-fix-bold-bezos', ticketId: 'TKT-456', agent: 'bold-bezos' },
        { name: 'TKT-789-research-keen-musk', ticketId: 'TKT-789', agent: 'keen-musk' },
      ];

      const agentName = 'bold-bezos';
      const agentSessions = sessions
        .filter(s => s.agent === agentName)
        .map(s => s.name);

      expect(agentSessions).to.have.lengthOf(2);
      expect(agentSessions).to.include('TKT-123-implement-bold-bezos');
      expect(agentSessions).to.include('TKT-456-fix-bold-bezos');
      expect(agentSessions).to.not.include('TKT-789-research-keen-musk');
    });

    it('should return empty array when no sessions match agent', () => {
      const sessions = [
        { name: 'TKT-123-implement-bold-bezos', ticketId: 'TKT-123', agent: 'bold-bezos' },
      ];

      const agentName = 'nonexistent-agent';
      const agentSessions = sessions
        .filter(s => s.agent === agentName)
        .map(s => s.name);

      expect(agentSessions).to.have.lengthOf(0);
    });

    it('should filter only TKT- prefixed sessions', () => {
      const rawSessionNames = [
        'TKT-123-implement-bold-bezos',
        'my-custom-session',
        'TKT-456-fix-keen-musk',
        'another-session',
      ];

      const sessions = rawSessionNames
        .map(name => parseSessionName(name))
        .filter(s => s.ticketId.startsWith('TKT-'));

      expect(sessions).to.have.lengthOf(2);
      expect(sessions[0].ticketId).to.equal('TKT-123');
      expect(sessions[1].ticketId).to.equal('TKT-456');
    });
  });
});
