export default {
  testEnvironment: 'node',
  transform: {},
  // Load .env.development before tests so JWT secrets etc. are available to route handlers
  setupFiles: ['./jest.env.setup.js'],
  // injectGlobals: true ensures jest, describe, test, expect etc. are available
  // as globals even in ESM mode (required for jest.resetModules() in test files)
  injectGlobals: true,
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/App.js',
    '!src/index.js',
    '!src/reportWebVitals.js',
    '!src/setupTests.js',
    '!src/components/**',
    '!src/utils/axiosConfig.js',
    '!**/__tests__/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
};
