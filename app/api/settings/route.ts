import { NextRequest, NextResponse } from "next/server";
import {
  getGlobalSettings,
  updateGlobalSettings,
  type UpdateGlobalSettingsInput,
} from "@/lib/settings";

export async function GET() {
  try {
    const current = getGlobalSettings();
    return NextResponse.json({ settings: current });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const updated = updateGlobalSettings(
      (body ?? {}) as UpdateGlobalSettingsInput,
    );
    return NextResponse.json({ settings: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
