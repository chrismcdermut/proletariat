import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readTelemetryConfig,
  writeTelemetryConfig,
  isTelemetryEnabled,
  hasShownTelemetryNotice,
  markTelemetryNoticeShown,
} from '../../src/lib/telemetry.js';

describe('Telemetry', () => {
  let testDir: string;
  let originalHome: string | undefined;
  let originalCI: string | undefined;
  let originalDoNotTrack: string | undefined;
  let originalPrltTelemetryDisabled: string | undefined;

  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-')));
    originalHome = process.env.HOME;
    process.env.HOME = testDir;

    // Save and clear env vars (CI must be cleared so tests can assert telemetry-enabled behavior)
    originalCI = process.env.CI;
    originalDoNotTrack = process.env.DO_NOT_TRACK;
    originalPrltTelemetryDisabled = process.env.PRLT_TELEMETRY_DISABLED;
    delete process.env.CI;
    delete process.env.DO_NOT_TRACK;
    delete process.env.PRLT_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Restore env vars
    if (originalCI !== undefined) {
      process.env.CI = originalCI;
    } else {
      delete process.env.CI;
    }

    if (originalDoNotTrack !== undefined) {
      process.env.DO_NOT_TRACK = originalDoNotTrack;
    } else {
      delete process.env.DO_NOT_TRACK;
    }

    if (originalPrltTelemetryDisabled !== undefined) {
      process.env.PRLT_TELEMETRY_DISABLED = originalPrltTelemetryDisabled;
    } else {
      delete process.env.PRLT_TELEMETRY_DISABLED;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('readTelemetryConfig', () => {
    it('returns empty config when no file exists', () => {
      const config = readTelemetryConfig();
      expect(config.enabled).to.be.undefined;
      expect(config.noticeShown).to.be.undefined;
    });

    it('reads telemetry config from machine config', () => {
      const configDir = path.join(testDir, '.proletariat');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ telemetry: false, telemetryNoticeShown: true })
      );

      const config = readTelemetryConfig();
      expect(config.enabled).to.equal(false);
      expect(config.noticeShown).to.equal(true);
    });

    it('handles corrupt config gracefully', () => {
      const configDir = path.join(testDir, '.proletariat');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.json'), 'not json');

      const config = readTelemetryConfig();
      expect(config.enabled).to.be.undefined;
    });
  });

  describe('writeTelemetryConfig', () => {
    it('creates config file if it does not exist', () => {
      writeTelemetryConfig({ enabled: true });

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.telemetry).to.equal(true);
    });

    it('preserves existing config fields', () => {
      const configDir = path.join(testDir, '.proletariat');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ version: '1.0.0', headquarters: [] })
      );

      writeTelemetryConfig({ enabled: false });

      const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8'));
      expect(config.telemetry).to.equal(false);
      expect(config.version).to.equal('1.0.0');
      expect(config.headquarters).to.deep.equal([]);
    });

    it('writes noticeShown flag', () => {
      writeTelemetryConfig({ noticeShown: true });

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.telemetryNoticeShown).to.equal(true);
    });
  });

  describe('isTelemetryEnabled', () => {
    it('returns true by default (opt-out model)', () => {
      expect(isTelemetryEnabled()).to.be.true;
    });

    it('returns false when DO_NOT_TRACK=1', () => {
      process.env.DO_NOT_TRACK = '1';
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('returns false when PRLT_TELEMETRY_DISABLED=1', () => {
      process.env.PRLT_TELEMETRY_DISABLED = '1';
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('returns false when user has disabled telemetry', () => {
      writeTelemetryConfig({ enabled: false });
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('returns true when user has explicitly enabled telemetry', () => {
      writeTelemetryConfig({ enabled: true });
      expect(isTelemetryEnabled()).to.be.true;
    });

    it('env var DO_NOT_TRACK overrides config', () => {
      writeTelemetryConfig({ enabled: true });
      process.env.DO_NOT_TRACK = '1';
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('env var PRLT_TELEMETRY_DISABLED overrides config', () => {
      writeTelemetryConfig({ enabled: true });
      process.env.PRLT_TELEMETRY_DISABLED = '1';
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('returns false when CI=true (auto-detect CI environment)', () => {
      process.env.CI = 'true';
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('returns false when CI=1', () => {
      process.env.CI = '1';
      expect(isTelemetryEnabled()).to.be.false;
    });

    it('CI env var overrides config', () => {
      writeTelemetryConfig({ enabled: true });
      process.env.CI = 'true';
      expect(isTelemetryEnabled()).to.be.false;
    });
  });

  describe('hasShownTelemetryNotice', () => {
    it('returns false when notice has not been shown', () => {
      expect(hasShownTelemetryNotice()).to.be.false;
    });

    it('returns true after notice is marked as shown', () => {
      markTelemetryNoticeShown();
      expect(hasShownTelemetryNotice()).to.be.true;
    });
  });

  describe('markTelemetryNoticeShown', () => {
    it('sets noticeShown in config', () => {
      markTelemetryNoticeShown();
      const config = readTelemetryConfig();
      expect(config.noticeShown).to.be.true;
    });

    it('preserves existing config', () => {
      writeTelemetryConfig({ enabled: false });
      markTelemetryNoticeShown();

      const config = readTelemetryConfig();
      expect(config.enabled).to.equal(false);
      expect(config.noticeShown).to.be.true;
    });
  });
});
