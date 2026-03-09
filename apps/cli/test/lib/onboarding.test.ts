import { expect } from 'chai';
import {
  detectRuntimes,
  displayRuntimeDetection,
  buildSetupPrompt,
} from '../../src/lib/onboarding/index.js';
import type { DetectedRuntime } from '../../src/lib/onboarding/index.js';

describe('onboarding', () => {
  describe('detectRuntimes', () => {
    it('should return an array', () => {
      const runtimes = detectRuntimes();
      expect(runtimes).to.be.an('array');
    });

    it('should return DetectedRuntime objects with required fields', () => {
      const runtimes = detectRuntimes();
      for (const rt of runtimes) {
        expect(rt).to.have.property('name').that.is.a('string');
        expect(rt).to.have.property('displayName').that.is.a('string');
        expect(rt).to.have.property('binary').that.is.a('string');
        // version is optional
        if (rt.version !== undefined) {
          expect(rt.version).to.be.a('string');
        }
      }
    });

    it('should only return known runtime names', () => {
      const knownNames = ['claude-code', 'codex'];
      const runtimes = detectRuntimes();
      for (const rt of runtimes) {
        expect(knownNames).to.include(rt.name);
      }
    });
  });

  describe('displayRuntimeDetection', () => {
    let originalLog: typeof console.log;
    let logOutput: string[];

    beforeEach(() => {
      originalLog = console.log;
      logOutput = [];
      console.log = (...args: unknown[]) => {
        logOutput.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('should display message when no runtimes found', () => {
      displayRuntimeDetection([]);
      const output = logOutput.join('\n');
      expect(output).to.contain('No AI coding agents detected');
    });

    it('should display detected runtimes', () => {
      const mockRuntimes: DetectedRuntime[] = [
        { name: 'claude-code', displayName: 'Claude Code', binary: 'claude', version: '1.0.0' },
      ];
      displayRuntimeDetection(mockRuntimes);
      const output = logOutput.join('\n');
      expect(output).to.contain('Detected AI coding agents');
      expect(output).to.contain('Claude Code');
    });

    it('should display multiple runtimes', () => {
      const mockRuntimes: DetectedRuntime[] = [
        { name: 'claude-code', displayName: 'Claude Code', binary: 'claude' },
        { name: 'codex', displayName: 'Codex', binary: 'codex' },
      ];
      displayRuntimeDetection(mockRuntimes);
      const output = logOutput.join('\n');
      expect(output).to.contain('Claude Code');
      expect(output).to.contain('Codex');
    });
  });

  describe('buildSetupPrompt', () => {
    it('should return a non-empty string', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.be.a('string');
      expect(prompt.length).to.be.greaterThan(0);
    });

    it('should mention prlt init command', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.contain('prlt init');
    });

    it('should mention --json flag', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.contain('--json');
    });

    it('should mention HQ Name setup step', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.contain('HQ Name');
    });

    it('should mention Repositories setup step', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.contain('Repositories');
    });

    it('should mention PMO setup step', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.contain('PMO');
    });

    it('should mention next steps commands', () => {
      const prompt = buildSetupPrompt();
      expect(prompt).to.contain('prlt agent list');
      expect(prompt).to.contain('prlt ticket create');
      expect(prompt).to.contain('prlt work start');
    });
  });
});
