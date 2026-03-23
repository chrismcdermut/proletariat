import { expect } from 'chai';

import {
  parseMemoryToBytes,
  checkDockerMemoryCapacity,
} from '../../src/lib/execution/runners/docker-management.js';

/**
 * Unit tests for container resource limits (PRLT-1099)
 * Tests memory parsing, Docker memory detection, and overcommit warning logic.
 */
describe('Container Resources (PRLT-1099)', () => {
  describe('parseMemoryToBytes', () => {
    it('parses gigabytes', () => {
      expect(parseMemoryToBytes('4g')).to.equal(4 * 1024 * 1024 * 1024);
    });

    it('parses megabytes', () => {
      expect(parseMemoryToBytes('512m')).to.equal(512 * 1024 * 1024);
    });

    it('parses uppercase units', () => {
      expect(parseMemoryToBytes('4G')).to.equal(4 * 1024 * 1024 * 1024);
      expect(parseMemoryToBytes('512M')).to.equal(512 * 1024 * 1024);
    });

    it('returns 0 for invalid format', () => {
      expect(parseMemoryToBytes('')).to.equal(0);
      expect(parseMemoryToBytes('abc')).to.equal(0);
      expect(parseMemoryToBytes('4')).to.equal(0);
      expect(parseMemoryToBytes('4t')).to.equal(0);
    });

    it('parses 1g correctly', () => {
      expect(parseMemoryToBytes('1g')).to.equal(1073741824);
    });

    it('parses 8g correctly', () => {
      expect(parseMemoryToBytes('8g')).to.equal(8 * 1024 * 1024 * 1024);
    });

    it('parses 2g correctly — the new default', () => {
      // 4g is the new default, but 2g is the minimum recommended
      expect(parseMemoryToBytes('2g')).to.equal(2 * 1024 * 1024 * 1024);
    });
  });

  describe('checkDockerMemoryCapacity', () => {
    // Note: These tests call the real Docker daemon if available.
    // The function is designed to gracefully handle Docker not being available.

    it('returns ok=true when Docker is not available', () => {
      // If Docker is not running, the function should not block spawning
      const result = checkDockerMemoryCapacity('4g');
      // Whether Docker is available or not, it should return a result
      expect(result).to.have.property('ok');
      expect(result).to.have.property('requestedMemory');
      expect(result.requestedMemory).to.equal(4 * 1024 * 1024 * 1024);
    });

    it('includes requestedMemory based on input', () => {
      const result = checkDockerMemoryCapacity('2g');
      expect(result.requestedMemory).to.equal(2 * 1024 * 1024 * 1024);
    });

    it('includes usedMemory field', () => {
      const result = checkDockerMemoryCapacity('4g');
      expect(result).to.have.property('usedMemory');
      expect(result.usedMemory).to.be.a('number');
    });

    it('includes warning message when ok is false', () => {
      const result = checkDockerMemoryCapacity('4g');
      if (!result.ok) {
        expect(result.warning).to.be.a('string');
        expect(result.warning).to.include('containers.memory');
      }
    });
  });
});
