import { expect } from 'chai';
import { checkGhCliStatus, requireGhCli } from '../../src/lib/pr/index.js';

/**
 * PRLT-1262: Differentiate gh not-installed vs not-authenticated errors
 *
 * Tests the shared `checkGhCliStatus` and `requireGhCli` helpers that
 * return distinct error codes / messages for the two failure modes.
 */
describe('GitHub CLI Status Differentiation (PRLT-1262)', () => {
  describe('checkGhCliStatus', () => {
    it('returns available=true when gh is installed and authenticated', () => {
      const status = checkGhCliStatus({
        installed: () => true,
        authenticated: () => true,
      });

      expect(status.available).to.equal(true);
      expect(status.installed).to.equal(true);
      expect(status.authenticated).to.equal(true);
    });

    it('returns GH_NOT_INSTALLED when gh is not installed', () => {
      const status = checkGhCliStatus({
        installed: () => false,
        authenticated: () => true,
      });

      expect(status.available).to.equal(false);
      if (status.available) throw new Error('expected unavailable');
      expect(status.installed).to.equal(false);
      expect(status.authenticated).to.equal(false);
      expect(status.code).to.equal('GH_NOT_INSTALLED');
      expect(status.message).to.contain('not installed');
      expect(status.fix).to.contain('cli.github.com');
    });

    it('returns GH_NOT_AUTHENTICATED when gh is installed but not authenticated', () => {
      const status = checkGhCliStatus({
        installed: () => true,
        authenticated: () => false,
      });

      expect(status.available).to.equal(false);
      if (status.available) throw new Error('expected unavailable');
      expect(status.installed).to.equal(true);
      expect(status.authenticated).to.equal(false);
      expect(status.code).to.equal('GH_NOT_AUTHENTICATED');
      expect(status.message).to.contain('not authenticated');
      expect(status.fix).to.contain('gh auth login');
    });

    it('prioritizes not-installed over not-authenticated when both fail', () => {
      // When gh is not installed, the auth check is meaningless — we should
      // report the install issue first so the fix instruction is correct.
      const status = checkGhCliStatus({
        installed: () => false,
        authenticated: () => false,
      });

      expect(status.available).to.equal(false);
      if (status.available) throw new Error('expected unavailable');
      expect(status.code).to.equal('GH_NOT_INSTALLED');
    });

    it('produces distinct error codes for the two failure modes', () => {
      // Regression: previously both cases produced the same generic error.
      const notInstalled = checkGhCliStatus({
        installed: () => false,
        authenticated: () => true,
      });
      const notAuthed = checkGhCliStatus({
        installed: () => true,
        authenticated: () => false,
      });

      if (notInstalled.available) throw new Error('expected unavailable');
      if (notAuthed.available) throw new Error('expected unavailable');

      expect(notInstalled.code).to.not.equal(notAuthed.code);
      expect(notInstalled.message).to.not.equal(notAuthed.message);
      expect(notInstalled.fix).to.not.equal(notAuthed.fix);
    });

    it('does not call authenticated() when installed() returns false', () => {
      // Avoid running `gh auth status` when gh isn't even installed —
      // it would just produce a confusing "command not found" error.
      let authCalled = false;
      checkGhCliStatus({
        installed: () => false,
        authenticated: () => {
          authCalled = true;
          return true;
        },
      });

      expect(authCalled).to.equal(false);
    });
  });

  describe('requireGhCli', () => {
    it('returns true and does not call handleError when gh is ready', () => {
      let errorCalled = false;
      const handleError = () => {
        errorCalled = true;
      };

      const ok = requireGhCli(handleError, {
        installed: () => true,
        authenticated: () => true,
      });

      expect(ok).to.equal(true);
      expect(errorCalled).to.equal(false);
    });

    it('returns false and calls handleError with GH_NOT_INSTALLED when not installed', () => {
      let calledCode: string | undefined;
      let calledMessage: string | undefined;
      const handleError = (code: string, message: string) => {
        calledCode = code;
        calledMessage = message;
      };

      const ok = requireGhCli(handleError, {
        installed: () => false,
        authenticated: () => true,
      });

      expect(ok).to.equal(false);
      expect(calledCode).to.equal('GH_NOT_INSTALLED');
      expect(calledMessage).to.contain('not installed');
      expect(calledMessage).to.contain('cli.github.com');
    });

    it('returns false and calls handleError with GH_NOT_AUTHENTICATED when not authenticated', () => {
      let calledCode: string | undefined;
      let calledMessage: string | undefined;
      const handleError = (code: string, message: string) => {
        calledCode = code;
        calledMessage = message;
      };

      const ok = requireGhCli(handleError, {
        installed: () => true,
        authenticated: () => false,
      });

      expect(ok).to.equal(false);
      expect(calledCode).to.equal('GH_NOT_AUTHENTICATED');
      expect(calledMessage).to.contain('not authenticated');
      expect(calledMessage).to.contain('gh auth login');
    });

    it('passes a combined message of message + fix to handleError', () => {
      let calledMessage: string | undefined;
      const handleError = (_code: string, message: string) => {
        calledMessage = message;
      };

      requireGhCli(handleError, {
        installed: () => false,
        authenticated: () => true,
      });

      // Both the problem and the fix should appear in the user-facing message
      expect(calledMessage).to.contain('not installed');
      expect(calledMessage).to.contain('Install it from');
    });
  });
});
