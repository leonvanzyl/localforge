import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
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
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="h-screen overflow-hidden bg-background text-foreground antialiased">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
