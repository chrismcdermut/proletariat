import { expect } from 'chai';

/**
 * Unit tests for multiline-input.ts
 *
 * Note: The actual multiline input function requires a TTY and is difficult
 * to test directly. These tests verify the module can be imported and the
 * interface is correct.
 */

describe('multiline-input', () => {
  describe('module exports', () => {
    it('exports multiLineInput function', async () => {
      const { multiLineInput } = await import('../../src/lib/multiline-input.js');
      expect(multiLineInput).to.be.a('function');
    });

    it('exports promptMultiLine function', async () => {
      const { promptMultiLine } = await import('../../src/lib/multiline-input.js');
      expect(promptMultiLine).to.be.a('function');
    });

    it('exports createMultiLinePrompt function', async () => {
      const { createMultiLinePrompt } = await import('../../src/lib/multiline-input.js');
      expect(createMultiLinePrompt).to.be.a('function');
    });
  });

  describe('non-TTY fallback', () => {
    it('returns default value when not a TTY', async () => {
      const { multiLineInput } = await import('../../src/lib/multiline-input.js');

      // In test environment, stdin is not a TTY
      // The function should return the default value
      const result = await multiLineInput({
        message: 'Test message',
        default: 'default value',
      });

      expect(result.value).to.equal('default value');
      expect(result.cancelled).to.equal(false);
    });

    it('returns empty string when no default and not a TTY', async () => {
      const { multiLineInput } = await import('../../src/lib/multiline-input.js');

      const result = await multiLineInput({
        message: 'Test message',
      });

      expect(result.value).to.equal('');
      expect(result.cancelled).to.equal(false);
    });
  });
});
