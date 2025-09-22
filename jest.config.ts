import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.(spec|test).ts?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/src/__tests__/helpers/',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: 'tsconfig.jest.json', useESM: true },
    ],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
};

export default config;
