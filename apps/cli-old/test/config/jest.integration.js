/**
 * Jest configuration for integration tests
 * Run with: pnpm run test:integration
 */

module.exports = {
  displayName: 'Integration Tests',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../../',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.integration.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/test/config/tsconfig.json'
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/**/__tests__/**',
    '!<rootDir>/src/**/*.test.ts',
  ],
  coverageDirectory: '<rootDir>/coverage-integration',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000, // Integration tests may take longer
  verbose: true,
  bail: false, // Continue running tests even if one fails
  setupFilesAfterEnv: ['<rootDir>/test/setup/integration.setup.ts'],
  globalSetup: '<rootDir>/test/setup/global.setup.ts',
  globalTeardown: '<rootDir>/test/setup/global.teardown.ts'],
};