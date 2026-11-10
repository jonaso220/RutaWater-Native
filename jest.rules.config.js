module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/firestore/__tests__/**/*.test.ts',
    '**/netlify/functions/_shared/__tests__/*.emulator.test.ts',
  ],
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', { presets: ['module:@react-native/babel-preset'] }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  // Ignore stale agent worktrees that carry their own copy of these tests.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
};
