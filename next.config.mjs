/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // In Next.js 16 this key moved out of `experimental`.
  serverExternalPackages: [
    "better-sqlite3",
    "@mariozechner/pi-coding-agent",
    "@mariozechner/pi-ai",
    "@mariozechner/pi-agent-core",
    "@mariozechner/pi-tui",
    "@mariozechner/clipboard",
    "koffi",
  ],
  // Empty turbopack object silences the Turbopack-vs-webpack mismatch warning;
  // better-sqlite3 is already excluded from the client bundle via
  // `serverExternalPackages` above.
  turbopack: {},
};

export default nextConfig;
