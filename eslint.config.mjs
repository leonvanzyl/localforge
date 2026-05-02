import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@next/next/no-sync-scripts": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["scripts/**/*.js", "tests/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".cursor/**",
      ".playwright/**",
      ".playwright-cli/**",
      ".playwright-mcp/**",
      ".tmp/**",
      "build/**",
      "data/**",
      "dist/**",
      "next-env.d.ts",
      "node_modules/**",
      "out/**",
      "playwright-report/**",
      "projects/**",
      "screenshots/**",
      "test-results/**",
      "tmp/**",
    ],
  },
];

export default eslintConfig;
