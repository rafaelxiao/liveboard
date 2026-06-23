module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
  overrides: [
    {
      // Test files: allow any for fixture/mock flexibility
      files: ["**/__tests__/**", "**/*.test.*", "**/test/setup.ts", "**/test/server.ts", "**/test/fixtures/**"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
