// Lean Jest config for pure-logic unit tests. We deliberately scope tests to
// __tests__/ folders next to the modules under test, NOT the whole src tree —
// component / hook tests would need RN preset, mocks, and renderer setup.
// Keep this minimal until we actually need it.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', { presets: ['module:@react-native/babel-preset'] }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  // Ignore stale agent worktrees that share package.json with the root.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
};
