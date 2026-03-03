import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hostCredentialsExist } from '../../src/lib/execution/runners.js';

describe('Host Credentials Check', () => {
  let fsExistsSyncStub: sinon.SinonStub;
  let fsReadFileSyncStub: sinon.SinonStub;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Stub fs methods
    fsExistsSyncStub = sinon.stub(fs, 'existsSync');
    fsReadFileSyncStub = sinon.stub(fs, 'readFileSync');
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;

    // Restore stubs
    fsExistsSyncStub.restore();
    fsReadFileSyncStub.restore();
  });

  describe('hostCredentialsExist', () => {
    it('returns true when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key';
      expect(hostCredentialsExist()).to.be.true;
    });

    it('returns true when OAuth credentials exist in ~/.claude/.credentials.json', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      fsExistsSyncStub.withArgs(credPath).returns(true);
      fsReadFileSyncStub.withArgs(credPath, 'utf-8').returns(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      }));

      expect(hostCredentialsExist()).to.be.true;
    });

    it('returns false when credentials file does not exist', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      fsExistsSyncStub.withArgs(credPath).returns(false);

      expect(hostCredentialsExist()).to.be.false;
    });

    it('returns false when credentials file exists but has no OAuth tokens', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      fsExistsSyncStub.withArgs(credPath).returns(true);
      fsReadFileSyncStub.withArgs(credPath, 'utf-8').returns(JSON.stringify({
        // No claudeAiOauth field
      }));

      expect(hostCredentialsExist()).to.be.false;
    });

    it('returns false when credentials file is malformed', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      fsExistsSyncStub.withArgs(credPath).returns(true);
      fsReadFileSyncStub.withArgs(credPath, 'utf-8').throws(new Error('Invalid JSON'));

      expect(hostCredentialsExist()).to.be.false;
    });

    it('prefers ANTHROPIC_API_KEY over OAuth credentials', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      fsExistsSyncStub.withArgs(credPath).returns(false);

      // Should return true without checking the file since API key is set
      expect(hostCredentialsExist()).to.be.true;
      expect(fsExistsSyncStub.called).to.be.false;
    });
  });
});
