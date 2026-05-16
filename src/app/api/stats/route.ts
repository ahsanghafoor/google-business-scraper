import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { Lead, DashboardStats } from "@/types";

export async function GET() {
  try {
    const totalLeadsRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM leads"
    );
    const totalLeads = parseInt(totalLeadsRow?.count || "0");

    const hotLeadsRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM leads WHERE lead_type = 'hot'"
    );
    const hotLeads = parseInt(hotLeadsRow?.count || "0");

    const warmLeadsRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM leads WHERE lead_type = 'warm'"
    );
    const warmLeads = parseInt(warmLeadsRow?.count || "0");

    const coldLeadsRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM leads WHERE lead_type = 'cold'"
    );
    const coldLeads = parseInt(coldLeadsRow?.count || "0");

    const totalSessionsRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM scrape_sessions"
    );
    const totalSessions = parseInt(totalSessionsRow?.count || "0");

    const leadsWithWebsiteRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM leads WHERE has_website = TRUE"
    );
    const leadsWithWebsite = parseInt(leadsWithWebsiteRow?.count || "0");

    const leadsWithoutWebsiteRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM leads WHERE has_website = FALSE"
    );
    const leadsWithoutWebsite = parseInt(leadsWithoutWebsiteRow?.count || "0");

    const avgScoreRow = await queryOne<{ avg: string | null }>(
      "SELECT AVG(overall_score) as avg FROM leads"
    );
    const avgScore = Math.round(parseFloat(avgScoreRow?.avg || "0"));

    const recentLeads = (await query(
      "SELECT * FROM leads ORDER BY created_at DESC LIMIT 10"
    )) as Lead[];

    const niches = (await query(
      "SELECT niche, COUNT(*) as count FROM leads GROUP BY niche ORDER BY count DESC LIMIT 10"
    )) as { niche: string; count: string }[];

    const pipeline = (await query(
      "SELECT pipeline_stage as stage, COUNT(*) as count FROM leads GROUP BY pipeline_stage ORDER BY count DESC"
    )) as { stage: string; count: string }[];

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
      niches: niches.map((n) => ({ niche: n.niche, count: parseInt(n.count) })),
      pipeline: pipeline.map((p) => ({ stage: p.stage, count: parseInt(p.count) })),
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
