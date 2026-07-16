const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const customJestConfig = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Don't transform node_modules except for Yjs (ESM)
  transformIgnorePatterns: [
    "/node_modules/(?!(yjs|y-indexeddb|lib0)/)",
  ],
};

module.exports = createJestConfig(customJestConfig);
