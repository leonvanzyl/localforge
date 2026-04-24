import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  DEFAULT_THEME,
  ThemeProvider,
} from "@/components/theme/theme-provider";

export const metadata: Metadata = {
  title: "LocalForge",
  description:
    "Autonomous coding harness powered by local LLMs via LM Studio. Describe your app and watch agents build it on your own hardware.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The server renders the default theme; the inline script below runs
  // before hydration and corrects the class/attribute from localStorage
  // so users never see a flash of the wrong theme. suppressHydrationWarning
  // prevents React from complaining about the class/attribute diff.
  return (
    <html
      lang="en"
      className={DEFAULT_THEME === "dark" ? "dark" : ""}
      data-theme={DEFAULT_THEME}
      style={{ colorScheme: DEFAULT_THEME }}
      suppressHydrationWarning
    >
      <head>
        {/* Google Fonts for the warm workshop design */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300..700&family=JetBrains+Mono:wght@400;500;600&family=Caveat:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="/theme-init.js" />
      </head>
      <body style={{ margin: 0, padding: 0, minHeight: "100vh", overflow: "hidden" }}>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
