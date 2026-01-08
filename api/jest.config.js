module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  rootDir: '.',
  testMatch: ['**/__tests__/**/*.js?(x)', '**/?(*.)+(spec|test).js?(x)'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  testPathIgnorePatterns: ['<rootDir>/__tests__/setup.js']
};