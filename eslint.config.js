import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/.tsbuildinfo",
      "**/*.tsbuildinfo",
      "coverage/**",
      "**/coverage/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  unicorn.configs["flat/recommended"],
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  n.configs["flat/recommended-module"],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: [
            "./tsconfig.json",
            "./packages/*/tsconfig.json",
            "./packages/middleware/*/tsconfig.json",
            "./examples/tsconfig.json",
          ],
        },
        node: true,
      },
    },
    rules: {
      // TypeScript correctness/safety
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-readonly": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: false,
          allowAny: false,
        },
      ],

      // Unicorn — light touch
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-array-callback-reference": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-useless-undefined": "off",
      "unicorn/prefer-event-target": "off",

      // Import organization
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-cycle": "error",
      "import/no-default-export": "error",
      "import/no-unresolved": "off", // TS handles this
      "import/named": "off", // TS handles this
      "import/namespace": "off", // TS handles this
      "import/no-named-as-default-member": "off", // false positives on tseslint
      // `export *` from multiple modules that re-export the same symbol is a
      // legitimate pattern for meta-packages (@arcp/sdk).
      "import/export": "off",

      // Node plugin
      "n/no-missing-import": "off",
      "n/no-unpublished-import": "off",
      "n/no-process-exit": "error",
      "n/no-extraneous-import": "off",
      "n/hashbang": "off",
    },
  },
  // Examples: relaxed rules — pedagogical, may use console, process.exit, etc.
  {
    files: ["examples/**/*.ts"],
    rules: {
      "no-console": "off",
      "n/no-process-exit": "off",
      "unicorn/no-process-exit": "off",
      // Node 22+ has stable `fetch`; the rule's default engines range flags
      // it broadly.
      "n/no-unsupported-features/node-builtins": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "unicorn/catch-error-name": "off",
      "unicorn/no-negated-condition": "off",
      "import/no-default-export": "off",
      "import/order": "off",
    },
  },
  // Tests
  {
    files: [
      "packages/*/test/**/*.ts",
      "packages/*/*/test/**/*.ts",
      "**/*.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "import/no-default-export": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Tests often use async wrappers for vitest hooks/handlers even when
      // the body is sync — that's idiomatic, not a bug.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "unicorn/filename-case": "off",
      // `.sort()` on a spread-copy is fine — the spread already made a new array.
      "unicorn/no-array-sort": "off",
      "unicorn/no-await-expression-member": "off",
    },
  },
  // stdio test helper — spawned as a subprocess by integration tests, behaves
  // like a CLI (uses process.exit, writes to stderr).
  {
    files: ["packages/sdk/test/helpers/stdio-runtime.ts"],
    rules: {
      "no-console": "off",
      "n/no-process-exit": "off",
      "unicorn/no-process-exit": "off",
    },
  },
  // CLI — commander's typings surface as `any`; unsafe-* are unavoidable here.
  {
    files: ["packages/sdk/src/cli.ts"],
    rules: {
      "no-console": "off",
      "n/no-process-exit": "off",
      "unicorn/no-process-exit": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  // Disable type-checked rules for non-TS files (JS/MJS)
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-console": "off",
    },
  },
  // Config files like vitest.config.ts and eslint.config.js
  {
    files: ["**/vitest.config.ts", "eslint.config.js", "**/*.config.*"],
    rules: {
      "import/no-default-export": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // eslint.config.js uses `import.meta.dirname`, supported in our Node
      // engines range (^22.16.0 or >=24) but the rule flags >=22 broadly.
      "n/no-unsupported-features/node-builtins": "off",
    },
  },
  prettier,
);
