import { expect } from 'chai';
import { slugify, formatDate, formatTimestamp, parseDate, generateId, deepClone, arraysEqual } from '../../src/lib/pmo/utils.js';

describe('PMO Utils', () => {
  describe('slugify', () => {
    it('converts string to lowercase', () => {
      expect(slugify('Hello World')).to.equal('hello-world');
    });

    it('replaces spaces with hyphens', () => {
      expect(slugify('foo bar baz')).to.equal('foo-bar-baz');
    });

    it('replaces underscores with hyphens', () => {
      expect(slugify('foo_bar_baz')).to.equal('foo-bar-baz');
    });

    it('removes special characters', () => {
      expect(slugify('Hello! @World#')).to.equal('hello-world');
    });

    it('collapses multiple hyphens', () => {
      expect(slugify('foo---bar')).to.equal('foo-bar');
    });

    it('removes leading/trailing hyphens', () => {
      expect(slugify('--foo-bar--')).to.equal('foo-bar');
    });

    it('limits length to 100 characters', () => {
      const longString = 'a'.repeat(150);
      expect(slugify(longString).length).to.equal(100);
    });

    it('handles empty string', () => {
      expect(slugify('')).to.equal('');
    });

    it('handles ticket-like titles', () => {
      expect(slugify('Implement user authentication')).to.equal('implement-user-authentication');
      expect(slugify('Fix bug #123')).to.equal('fix-bug-123');
      expect(slugify('[URGENT] Deploy hotfix')).to.equal('urgent-deploy-hotfix');
    });
  });

  describe('formatDate', () => {
    it('formats date as ISO date string', () => {
      const date = new Date('2024-03-15T10:30:00Z');
      expect(formatDate(date)).to.equal('2024-03-15');
    });
  });

  describe('formatTimestamp', () => {
    it('formats date as ISO timestamp', () => {
      const date = new Date('2024-03-15T10:30:00.000Z');
      expect(formatTimestamp(date)).to.equal('2024-03-15T10:30:00.000Z');
    });
  });

  describe('parseDate', () => {
    it('parses ISO date string', () => {
      const date = parseDate('2024-03-15T10:30:00.000Z');
      expect(date.getUTCFullYear()).to.equal(2024);
      expect(date.getUTCMonth()).to.equal(2); // 0-indexed
      expect(date.getUTCDate()).to.equal(15);
    });
  });

  describe('generateId', () => {
    it('generates unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).to.not.equal(id2);
    });

    it('generates IDs with expected format', () => {
      const id = generateId();
      expect(id).to.match(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('deepClone', () => {
    it('clones simple objects', () => {
      const obj = { a: 1, b: 'two' };
      const cloned = deepClone(obj);
      expect(cloned).to.deep.equal(obj);
      expect(cloned).to.not.equal(obj);
    });

    it('clones nested objects', () => {
      const obj = { a: { b: { c: 1 } } };
      const cloned = deepClone(obj);
      expect(cloned).to.deep.equal(obj);
      expect(cloned.a).to.not.equal(obj.a);
    });

    it('clones arrays', () => {
      const arr = [1, 2, { a: 3 }];
      const cloned = deepClone(arr);
      expect(cloned).to.deep.equal(arr);
      expect(cloned).to.not.equal(arr);
    });
  });

  describe('arraysEqual', () => {
    it('returns true for equal arrays', () => {
      expect(arraysEqual([1, 2, 3], [1, 2, 3])).to.be.true;
    });

    it('returns true regardless of order', () => {
      expect(arraysEqual([1, 2, 3], [3, 1, 2])).to.be.true;
    });

    it('returns false for different lengths', () => {
      expect(arraysEqual([1, 2], [1, 2, 3])).to.be.false;
    });

    it('returns false for different elements', () => {
      expect(arraysEqual([1, 2, 3], [1, 2, 4])).to.be.false;
    });

    it('handles empty arrays', () => {
      expect(arraysEqual([], [])).to.be.true;
    });

    it('handles string arrays', () => {
      expect(arraysEqual(['a', 'b'], ['b', 'a'])).to.be.true;
    });
  });
});
