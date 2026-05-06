import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Lead, DashboardStats } from "@/types";

export async function GET() {
  try {
    const db = getDb();

    const totalLeads = (
      db.prepare("SELECT COUNT(*) as count FROM leads").get() as {
        count: number;
      }
    ).count;

    const hotLeads = (
      db
        .prepare("SELECT COUNT(*) as count FROM leads WHERE lead_type = 'hot'")
        .get() as { count: number }
    ).count;

    const warmLeads = (
      db
        .prepare("SELECT COUNT(*) as count FROM leads WHERE lead_type = 'warm'")
        .get() as { count: number }
    ).count;

    const coldLeads = (
      db
        .prepare("SELECT COUNT(*) as count FROM leads WHERE lead_type = 'cold'")
        .get() as { count: number }
    ).count;

    const totalSessions = (
      db.prepare("SELECT COUNT(*) as count FROM scrape_sessions").get() as {
        count: number;
      }
    ).count;

    const leadsWithWebsite = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM leads WHERE has_website = 1"
        )
        .get() as { count: number }
    ).count;

    const leadsWithoutWebsite = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM leads WHERE has_website = 0"
        )
        .get() as { count: number }
    ).count;

    const avgScoreResult = db
      .prepare("SELECT AVG(overall_score) as avg FROM leads")
      .get() as { avg: number | null };
    const avgScore = Math.round(avgScoreResult.avg || 0);

    const recentLeads = db
      .prepare(
        "SELECT * FROM leads ORDER BY created_at DESC LIMIT 10"
      )
      .all() as Lead[];

    const niches = db
      .prepare(
        "SELECT niche, COUNT(*) as count FROM leads GROUP BY niche ORDER BY count DESC LIMIT 10"
      )
      .all() as { niche: string; count: number }[];

    const pipeline = db
      .prepare(
        "SELECT pipeline_stage as stage, COUNT(*) as count FROM leads GROUP BY pipeline_stage ORDER BY count DESC"
      )
      .all() as { stage: string; count: number }[];

    const stats: DashboardStats = {
      total_leads: totalLeads,
      hot_leads: hotLeads,
      warm_leads: warmLeads,
      cold_leads: coldLeads,
      total_sessions: totalSessions,
      leads_with_website: leadsWithWebsite,
      leads_without_website: leadsWithoutWebsite,
      avg_score: avgScore,
      recent_leads: recentLeads,
      niches,
      pipeline,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
