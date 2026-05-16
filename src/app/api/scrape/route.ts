import { NextRequest, NextResponse } from "next/server";
import { startScrapeSession } from "@/lib/scrape-manager";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { niche, area, maxResults = 20 } = body;

    if (!niche || !area) {
      return NextResponse.json(
        { error: "niche and area are required" },
        { status: 400 }
      );
    }

    const sessionId = await startScrapeSession(
      niche.trim(),
      area.trim(),
      Math.min(maxResults, 50)
    );

    return NextResponse.json({ session_id: sessionId });
  } catch (error) {
    console.error("Scrape start error:", error);
    return NextResponse.json(
      { error: "Failed to start scrape" },
      { status: 500 }
    );
  }
}
