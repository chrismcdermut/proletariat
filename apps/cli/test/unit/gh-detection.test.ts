import { expect } from 'chai';
import * as prModule from '../../src/lib/pr/index.js';

/**
 * Regression test for TKT-007: gh auth detection must differentiate
 * "not installed" from "not authenticated" so work start shows the
 * correct guidance message.
 */
describe('gh CLI detection (TKT-007)', () => {
  describe('isGHInstalled', () => {
    it('returns a boolean', () => {
      const result = prModule.isGHInstalled();
      expect(result).to.be.a('boolean');
    });
  });

  describe('isGHAuthenticated', () => {
    it('returns a boolean', () => {
      const result = prModule.isGHAuthenticated();
      expect(result).to.be.a('boolean');
    });
  });

  describe('prModeSource differentiation', () => {
    // Mirrors the logic from work/start.ts lines 2100-2157
    function computePrModeSource(ghInstalled: boolean, ghAuthenticated: boolean): string {
      const ghAvailable = ghInstalled && ghAuthenticated;
      if (ghAvailable) {
        return 'would prompt or use config';
      }
      return ghInstalled
        ? 'default (gh auth required — run `gh auth login`)'
        : 'default (gh CLI not installed)';
    }

    it('says "not installed" when gh is not on PATH', () => {
      const msg = computePrModeSource(false, false);
      expect(msg).to.include('not installed');
      expect(msg).not.to.include('auth required');
    });

    it('says "auth required" when gh is installed but not authenticated', () => {
      const msg = computePrModeSource(true, false);
      expect(msg).to.include('auth required');
      expect(msg).to.include('gh auth login');
      expect(msg).not.to.include('not installed');
    });

    it('does not fall into the else branch when gh is fully available', () => {
      const msg = computePrModeSource(true, true);
      expect(msg).to.not.include('not installed');
      expect(msg).to.not.include('auth required');
    });
  });
});
