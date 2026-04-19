import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/db";

// GET /api/health - basic liveness + DB connection check.
// Used by Feature 0 (Database connection established).
export async function GET() {
  const dbStatus = await checkDatabaseConnection();
  return NextResponse.json({
    status: "ok",
    database: dbStatus ? "connected" : "error",
    timestamp: new Date().toISOString(),
  });
}
