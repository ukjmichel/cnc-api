import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.(spec|test).ts?(x)'],
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
