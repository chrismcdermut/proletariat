import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  scrubString,
  scrubObject,
  isTestEnvironment,
  isNonInteractive,
  getEnvironment,
  DATA_DISCLOSURE,
} from '../../src/lib/telemetry/sentry.js';

/**
 * Unit tests for Sentry telemetry module
 * TKT-132: Error tracking with privacy-first approach
 */
describe('Telemetry Sentry', () => {
  describe('scrubString', () => {
    describe('scrubs macOS paths', () => {
      it('scrubs /Users/username paths', () => {
        const input = 'Error at /Users/john/projects/myapp/src/index.ts';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('/Users/john');
      });

      it('scrubs home directory shorthand', () => {
        const input = 'Cannot read file ~/Documents/secret.txt';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('~/Documents');
      });
    });

    describe('scrubs Linux paths', () => {
      it('scrubs /home/username paths', () => {
        const input = 'Error at /home/developer/workspace/app/main.ts';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('/home/developer');
      });

      it('scrubs /var paths', () => {
        const input = 'Log file at /var/log/prlt/debug.log';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('/var/log');
      });

      it('scrubs /tmp paths', () => {
        const input = 'Temp file at /tmp/prlt-12345/config.json';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('/tmp/prlt');
      });
    });

    describe('scrubs Windows paths', () => {
      it('scrubs C:\\Users\\username paths', () => {
        const input = 'Error at C:\\Users\\John\\Projects\\app\\main.ts';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('C:\\Users\\John');
      });
    });

    describe('scrubs container paths', () => {
      it('scrubs /workspace paths', () => {
        const input = 'Working in /workspace/my-project/src/lib';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_PATHS]');
        expect(result).to.not.include('/workspace/my-project');
      });
    });

    describe('scrubs repository URLs', () => {
      it('scrubs GitHub URLs', () => {
        const input = 'Cloning from github.com/myorg/private-repo';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_REPOS]');
        expect(result).to.not.include('github.com/myorg/private-repo');
      });

      it('scrubs GitLab URLs', () => {
        const input = 'Repository at gitlab.com/company/internal-tool';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_REPOS]');
        expect(result).to.not.include('gitlab.com/company');
      });

      it('scrubs Bitbucket URLs', () => {
        const input = 'Source: bitbucket.org/team/project';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_REPOS]');
        expect(result).to.not.include('bitbucket.org/team');
      });
    });

    describe('scrubs secrets and tokens', () => {
      it('scrubs API keys', () => {
        const input = 'api_key=sk-12345abcdef';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_SECRETS]');
        expect(result).to.not.include('sk-12345abcdef');
      });

      it('scrubs Bearer tokens', () => {
        const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_SECRETS]');
        expect(result).to.not.include('eyJhbG');
      });

      it('scrubs GitHub tokens', () => {
        const input = 'Using token ghp_abc123def456ghi789';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_SECRETS]');
        expect(result).to.not.include('ghp_abc123');
      });

      it('scrubs password fields', () => {
        const input = 'password: mysecretpassword123';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_SECRETS]');
        expect(result).to.not.include('mysecretpassword');
      });
    });

    describe('scrubs email addresses', () => {
      it('scrubs standard emails', () => {
        const input = 'User email is john.doe@example.com';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_EMAILS]');
        expect(result).to.not.include('john.doe@example.com');
      });

      it('scrubs emails with plus signs', () => {
        const input = 'Contact: user+tag@company.org';
        const result = scrubString(input);
        expect(result).to.include('[REDACTED_EMAILS]');
        expect(result).to.not.include('user+tag@company.org');
      });
    });

    describe('preserves safe content', () => {
      it('preserves error messages without PII', () => {
        const input = 'Database connection failed';
        const result = scrubString(input);
        expect(result).to.equal('Database connection failed');
      });

      it('preserves command names', () => {
        const input = 'Running command: work start';
        const result = scrubString(input);
        expect(result).to.equal('Running command: work start');
      });

      it('preserves version numbers', () => {
        const input = 'CLI version 0.3.14, Node.js v20.10.0';
        const result = scrubString(input);
        expect(result).to.equal('CLI version 0.3.14, Node.js v20.10.0');
      });
    });
  });

  describe('scrubObject', () => {
    it('scrubs nested objects', () => {
      const input = {
        error: 'Failed at /Users/john/project/src/main.ts',
        nested: {
          location: '/home/user/workspace',  // 'path' keys are fully redacted
        },
      };
      const result = scrubObject(input) as typeof input;
      expect(result.error).to.include('[REDACTED_PATHS]');
      expect(result.nested.location).to.include('[REDACTED_PATHS]');
    });

    it('scrubs arrays', () => {
      const input = [
        '/Users/john/a.ts',
        '/home/user/b.ts',
      ];
      const result = scrubObject(input) as string[];
      expect(result[0]).to.include('[REDACTED_PATHS]');
      expect(result[1]).to.include('[REDACTED_PATHS]');
    });

    it('redacts sensitive keys entirely', () => {
      const input = {
        password: 'secret123',
        token: 'abc123',
        authHeader: 'Bearer xyz',
        credentials: { api: 'key' },
        envVars: { HOME: '/home/user' },
      };
      const result = scrubObject(input) as Record<string, unknown>;
      expect(result.password).to.equal('[REDACTED]');
      expect(result.token).to.equal('[REDACTED]');
      expect(result.authHeader).to.equal('[REDACTED]');
      expect(result.credentials).to.equal('[REDACTED]');
      expect(result.envVars).to.equal('[REDACTED]');
    });

    it('preserves primitive values', () => {
      expect(scrubObject(123)).to.equal(123);
      expect(scrubObject(true)).to.equal(true);
      expect(scrubObject(null)).to.equal(null);
    });
  });

  describe('isTestEnvironment', () => {
    it('returns true when NODE_ENV is test', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        expect(isTestEnvironment()).to.equal(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('returns true when VITEST is set', () => {
      const originalEnv = process.env.VITEST;
      process.env.VITEST = 'true';
      try {
        expect(isTestEnvironment()).to.equal(true);
      } finally {
        delete process.env.VITEST;
        if (originalEnv !== undefined) {
          process.env.VITEST = originalEnv;
        }
      }
    });
  });

  describe('isNonInteractive', () => {
    it('returns true when CI is set', () => {
      const originalCI = process.env.CI;
      process.env.CI = 'true';
      try {
        expect(isNonInteractive()).to.equal(true);
      } finally {
        delete process.env.CI;
        if (originalCI !== undefined) {
          process.env.CI = originalCI;
        }
      }
    });

    it('returns true when GITHUB_ACTIONS is set', () => {
      const original = process.env.GITHUB_ACTIONS;
      process.env.GITHUB_ACTIONS = 'true';
      try {
        expect(isNonInteractive()).to.equal(true);
      } finally {
        delete process.env.GITHUB_ACTIONS;
        if (original !== undefined) {
          process.env.GITHUB_ACTIONS = original;
        }
      }
    });
  });

  describe('getEnvironment', () => {
    it('returns test when in test environment', () => {
      // This test runs in test environment
      expect(getEnvironment()).to.equal('test');
    });
  });

  describe('DATA_DISCLOSURE', () => {
    it('includes what is collected', () => {
      expect(DATA_DISCLOSURE).to.include('Error messages');
      expect(DATA_DISCLOSURE).to.include('Command name');
      expect(DATA_DISCLOSURE).to.include('CLI version');
      expect(DATA_DISCLOSURE).to.include('Node.js version');
      expect(DATA_DISCLOSURE).to.include('platform');
    });

    it('includes what is NOT collected', () => {
      expect(DATA_DISCLOSURE).to.include('NEVER');
      expect(DATA_DISCLOSURE).to.include('File paths');
      expect(DATA_DISCLOSURE).to.include('repository names');
      expect(DATA_DISCLOSURE).to.include('Environment variables');
      expect(DATA_DISCLOSURE).to.include('tokens');
      expect(DATA_DISCLOSURE).to.include('secrets');
    });
  });
});
