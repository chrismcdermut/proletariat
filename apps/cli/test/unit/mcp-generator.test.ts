import { expect } from 'chai';
import { commandIdToToolName } from '../../src/lib/mcp/generator.js';

describe('@smoke MCP Tool Generator', () => {
  describe('commandIdToToolName', () => {
    it('converts colon-separated command IDs to snake_case', () => {
      expect(commandIdToToolName('ticket:list')).to.equal('ticket_list');
      expect(commandIdToToolName('agent:staff:add')).to.equal('agent_staff_add');
      expect(commandIdToToolName('work:hooks:remove')).to.equal('work_hooks_remove');
    });

    it('converts hyphens to underscores', () => {
      expect(commandIdToToolName('mcp-server')).to.equal('mcp_server');
      expect(commandIdToToolName('claude-yolo')).to.equal('claude_yolo');
    });

    it('handles single-word command IDs', () => {
      expect(commandIdToToolName('whoami')).to.equal('whoami');
      expect(commandIdToToolName('commit')).to.equal('commit');
    });
  });
});
