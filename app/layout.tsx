import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell/app-shell";

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
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
