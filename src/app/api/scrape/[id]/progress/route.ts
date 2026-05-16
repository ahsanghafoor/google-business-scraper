import { NextRequest, NextResponse } from "next/server";
import { getProgress } from "@/lib/scrape-manager";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const progress = getProgress(id);

  if (!progress) {
    return NextResponse.json(
      { stage: "unknown", total: 0, scraped: 0, skipped: 0 },
      { status: 200 }
    );
  }

  return NextResponse.json(progress);
}
