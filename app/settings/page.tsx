import { getGlobalSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const current = getGlobalSettings();
  return (
    <div
      data-testid="settings-page"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10"
    >
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Global settings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure the local model server and where LocalForge stores project
          folders on disk. These values are saved to SQLite and apply to every
          project unless a project override is set.
        </p>
      </header>
      <SettingsForm initial={current} />
    </div>
  );
}
