import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const niche = url.searchParams.get("niche");
    const area = url.searchParams.get("area");
    const leadType = url.searchParams.get("lead_type");

    const conditions: string[] = [];
    const params: string[] = [];
    let paramIdx = 1;

    if (niche) {
      conditions.push(`niche = $${paramIdx++}`);
      params.push(niche);
    }
    if (area) {
      conditions.push(`area = $${paramIdx++}`);
      params.push(area);
    }
    if (leadType) {
      conditions.push(`lead_type = $${paramIdx++}`);
      params.push(leadType);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const leads = await query<Record<string, unknown>>(
      `SELECT business_name, phone, email, website, address, area, niche, category, rating, review_count, overall_score, lead_type, approach_status, pipeline_stage, gmb_link, seo_score, gmb_score, issues_count, created_at FROM leads ${whereClause} ORDER BY overall_score DESC`,
      params
    );

    const headers = [
      "Business Name",
      "Phone",
      "Email",
      "Website",
      "Address",
      "Area",
      "Niche",
      "Category",
      "Rating",
      "Reviews",
      "Score",
      "Lead Type",
      "Status",
      "Pipeline",
      "GMB Link",
      "SEO Score",
      "GMB Score",
      "Issues",
      "Scraped At",
    ];

    const csvRows = [headers.join(",")];

    for (const lead of leads) {
      const row = [
        lead.business_name,
        lead.phone,
        lead.email,
        lead.website,
        lead.address,
        lead.area,
        lead.niche,
        lead.category,
        lead.rating,
        lead.review_count,
        lead.overall_score,
        lead.lead_type,
        lead.approach_status,
        lead.pipeline_stage,
        lead.gmb_link,
        lead.seo_score,
        lead.gmb_score,
        lead.issues_count,
        lead.created_at,
      ].map((val) => {
        const str = String(val ?? "");
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(row.join(","));
    }

    const csv = csvRows.join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="leads-export-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export leads" },
      { status: 500 }
    );
  }
}
