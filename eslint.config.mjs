// ESLint flat config for Next.js 16. `next lint` was removed in Next 16; the
// upstream guidance is to run `eslint` directly with the official Next config.
// See https://nextjs.org/docs/app/api-reference/config/eslint
import nextConfig from "eslint-config-next";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "playwright-report/**",
      "test-results/**",
      "projects/**",
      "*.log",
    ],
  },
  ...nextConfig,
];

export default config;
