import { expect } from 'chai';
import {
  getAgentsWithCounts,
  getAvailableAgents,
  selectAgent,
  AgentStrategy,
} from '../../src/lib/execution/spawner.js';
import { ExecutionStorage } from '../../src/lib/execution/storage.js';
import { WorkspaceInfo } from '../../src/lib/agents/commands.js';
import { Agent } from '../../src/lib/database/index.js';

/**
 * Mock ExecutionStorage for testing agent selection strategies
 */
class MockExecutionStorage {
  private agentExecutionCounts: Map<string, number> = new Map();
  private busyAgents: Set<string> = new Set();

  setAgentExecutionCount(agentName: string, count: number): void {
    this.agentExecutionCounts.set(agentName, count);
  }

  setAgentBusy(agentName: string, busy: boolean): void {
    if (busy) {
      this.busyAgents.add(agentName);
    } else {
      this.busyAgents.delete(agentName);
    }
  }

  isAgentAvailable(agentName: string): boolean {
    return !this.busyAgents.has(agentName);
  }

  getAgentRunningExecutions(agentName: string): { id: string }[] {
    return this.busyAgents.has(agentName) ? [{ id: 'mock-execution' }] : [];
  }

  getAgentExecutionCount(agentName: string): number {
    return this.agentExecutionCounts.get(agentName) ?? 0;
  }
}

function createMockAgent(name: string): Agent {
  return {
    name,
    theme: 'simpsons',
    status: 'idle',
    created_at: new Date().toISOString(),
  };
}

function createMockWorkspaceInfo(agents: Agent[]): WorkspaceInfo {
  return {
    path: '/path/to/workspace',
    type: 'hq',
    theme: 'simpsons',
    workspaceName: 'test-workspace',
    hasPMO: true,
    agents,
    repositories: [],
    agentsPath: '/path/to/agents',
  };
}

describe('Spawner Module', () => {
  describe('getAgentsWithCounts', () => {
    it('returns empty array when no agents configured', () => {
      const workspaceInfo = createMockWorkspaceInfo([]);
      const mockStorage = new MockExecutionStorage();

      const result = getAgentsWithCounts(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.deep.equal([]);
    });

    it('returns agent counts with no executions', () => {
      const workspaceInfo = createMockWorkspaceInfo([
        createMockAgent('agent-1'),
        createMockAgent('agent-2'),
      ]);
      const mockStorage = new MockExecutionStorage();

      const result = getAgentsWithCounts(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.have.length(2);
      expect(result[0]).to.deep.equal({
        name: 'agent-1',
        runningCount: 0,
        totalCount: 0,
      });
      expect(result[1]).to.deep.equal({
        name: 'agent-2',
        runningCount: 0,
        totalCount: 0,
      });
    });

    it('returns correct counts for agents with executions', () => {
      const workspaceInfo = createMockWorkspaceInfo([
        createMockAgent('agent-1'),
        createMockAgent('agent-2'),
      ]);
      const mockStorage = new MockExecutionStorage();
      mockStorage.setAgentExecutionCount('agent-1', 5);
      mockStorage.setAgentExecutionCount('agent-2', 10);
      mockStorage.setAgentBusy('agent-1', true);

      const result = getAgentsWithCounts(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.have.length(2);
      expect(result[0]).to.deep.equal({
        name: 'agent-1',
        runningCount: 1,
        totalCount: 5,
      });
      expect(result[1]).to.deep.equal({
        name: 'agent-2',
        runningCount: 0,
        totalCount: 10,
      });
    });
  });

  describe('getAvailableAgents', () => {
    it('returns empty array when no agents configured', () => {
      const workspaceInfo = createMockWorkspaceInfo([]);
      const mockStorage = new MockExecutionStorage();

      const result = getAvailableAgents(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.deep.equal([]);
    });

    it('returns all agents when none are busy', () => {
      const workspaceInfo = createMockWorkspaceInfo([
        createMockAgent('agent-1'),
        createMockAgent('agent-2'),
        createMockAgent('agent-3'),
      ]);
      const mockStorage = new MockExecutionStorage();

      const result = getAvailableAgents(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.deep.equal(['agent-1', 'agent-2', 'agent-3']);
    });

    it('filters out busy agents', () => {
      const workspaceInfo = createMockWorkspaceInfo([
        createMockAgent('agent-1'),
        createMockAgent('agent-2'),
        createMockAgent('agent-3'),
      ]);
      const mockStorage = new MockExecutionStorage();
      mockStorage.setAgentBusy('agent-2', true);

      const result = getAvailableAgents(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.deep.equal(['agent-1', 'agent-3']);
    });

    it('returns empty array when all agents are busy', () => {
      const workspaceInfo = createMockWorkspaceInfo([
        createMockAgent('agent-1'),
        createMockAgent('agent-2'),
      ]);
      const mockStorage = new MockExecutionStorage();
      mockStorage.setAgentBusy('agent-1', true);
      mockStorage.setAgentBusy('agent-2', true);

      const result = getAvailableAgents(
        workspaceInfo,
        mockStorage as unknown as ExecutionStorage
      );

      expect(result).to.deep.equal([]);
    });
  });

  describe('selectAgent', () => {
    describe('with empty agents list', () => {
      it('returns null when no agents available', () => {
        const mockStorage = new MockExecutionStorage();

        const result = selectAgent(
          'round-robin',
          [],
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.be.null;
      });
    });

    describe('round-robin strategy', () => {
      it('selects first agent when no state provided', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1', 'agent-2', 'agent-3'];

        const result = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-1');
      });

      it('cycles through agents in order', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1', 'agent-2', 'agent-3'];
        const state = { lastIndex: -1 };

        const result1 = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage,
          state
        );
        expect(result1).to.equal('agent-1');
        expect(state.lastIndex).to.equal(0);

        const result2 = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage,
          state
        );
        expect(result2).to.equal('agent-2');
        expect(state.lastIndex).to.equal(1);

        const result3 = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage,
          state
        );
        expect(result3).to.equal('agent-3');
        expect(state.lastIndex).to.equal(2);
      });

      it('wraps around to first agent after reaching end', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1', 'agent-2'];
        const state = { lastIndex: 1 };

        const result = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage,
          state
        );

        expect(result).to.equal('agent-1');
        expect(state.lastIndex).to.equal(0);
      });

      it('handles single agent', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1'];
        const state = { lastIndex: -1 };

        const result1 = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage,
          state
        );
        expect(result1).to.equal('agent-1');

        const result2 = selectAgent(
          'round-robin',
          agents,
          mockStorage as unknown as ExecutionStorage,
          state
        );
        expect(result2).to.equal('agent-1');
      });
    });

    describe('least-busy strategy', () => {
      it('selects agent with lowest execution count', () => {
        const mockStorage = new MockExecutionStorage();
        mockStorage.setAgentExecutionCount('agent-1', 10);
        mockStorage.setAgentExecutionCount('agent-2', 5);
        mockStorage.setAgentExecutionCount('agent-3', 15);
        const agents = ['agent-1', 'agent-2', 'agent-3'];

        const result = selectAgent(
          'least-busy',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-2');
      });

      it('selects first agent when all have same count', () => {
        const mockStorage = new MockExecutionStorage();
        mockStorage.setAgentExecutionCount('agent-1', 5);
        mockStorage.setAgentExecutionCount('agent-2', 5);
        mockStorage.setAgentExecutionCount('agent-3', 5);
        const agents = ['agent-1', 'agent-2', 'agent-3'];

        const result = selectAgent(
          'least-busy',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-1');
      });

      it('handles agents with zero executions', () => {
        const mockStorage = new MockExecutionStorage();
        mockStorage.setAgentExecutionCount('agent-1', 10);
        // agent-2 has no count set (defaults to 0)
        const agents = ['agent-1', 'agent-2'];

        const result = selectAgent(
          'least-busy',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-2');
      });

      it('selects first agent with minimum count when tie exists', () => {
        const mockStorage = new MockExecutionStorage();
        mockStorage.setAgentExecutionCount('agent-1', 10);
        mockStorage.setAgentExecutionCount('agent-2', 3);
        mockStorage.setAgentExecutionCount('agent-3', 3);
        const agents = ['agent-1', 'agent-2', 'agent-3'];

        const result = selectAgent(
          'least-busy',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-2');
      });
    });

    describe('random strategy', () => {
      it('returns an agent from the available list', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1', 'agent-2', 'agent-3'];

        const result = selectAgent(
          'random',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(agents).to.include(result);
      });

      it('returns the only agent when single agent available', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1'];

        const result = selectAgent(
          'random',
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-1');
      });

      it('returns different agents over multiple calls (probabilistic)', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
        const selectedAgents = new Set<string>();

        // Run multiple times to verify randomness
        for (let i = 0; i < 50; i++) {
          const result = selectAgent(
            'random',
            agents,
            mockStorage as unknown as ExecutionStorage
          );
          if (result) {
            selectedAgents.add(result);
          }
        }

        // With 50 iterations and 5 agents, we should see at least 2 different agents
        expect(selectedAgents.size).to.be.greaterThan(1);
      });
    });

    describe('default/unknown strategy', () => {
      it('returns first agent for unknown strategy', () => {
        const mockStorage = new MockExecutionStorage();
        const agents = ['agent-1', 'agent-2', 'agent-3'];

        const result = selectAgent(
          'unknown-strategy' as AgentStrategy,
          agents,
          mockStorage as unknown as ExecutionStorage
        );

        expect(result).to.equal('agent-1');
      });
    });
  });
});
