// jest.config.js - Minimal version without setup files
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',

  // Critical: Run tests serially to avoid database conflicts
  maxWorkers: 1,

  // Ensure tests don't interfere with each other
  forceExit: true,
  detectOpenHandles: true,

  // Increase timeout for database operations
  testTimeout: 30000,

  // Remove these lines if you don't have setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.env.ts'],
  // globalTeardown: '<rootDir>/src/__tests__/teardown.ts',

  // Transform configuration for ES modules
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          target: 'es2020',
          moduleResolution: 'node',
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
        },
      },
    ],
  },

  // Module name mapping for ES modules
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Test file patterns
  testMatch: [
    '<rootDir>/src/__tests__/**/*.spec.ts',
    '<rootDir>/src/__tests__/**/*.test.ts',
  ],

  // COVERAGE CONFIGURATION
  collectCoverage: false, // Set to true when running coverage
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/types/**/*',
    '!src/config/db.ts',
    '!src/app.ts',
    '!src/server.ts',
    '!src/migrations/**/*',
    '!src/seeders/**/*',
    '!src/models/**/*',
  ],

  // Coverage reporting
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],

  // Module file extensions
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/coverage/'],

  // Coverage path ignore patterns
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/__tests__/',
    '/migrations/',
    '/seeders/',
    '/models/',
  ],

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Verbose output for debugging
  verbose: true,
};
