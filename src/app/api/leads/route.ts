import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const niche = url.searchParams.get("niche");
    const area = url.searchParams.get("area");
    const leadType = url.searchParams.get("lead_type");
    const status = url.searchParams.get("status");
    const pipeline = url.searchParams.get("pipeline_stage");
    const hasWebsite = url.searchParams.get("has_website");
    const search = url.searchParams.get("search");
    const sessionId = url.searchParams.get("session_id");
    const sortBy = url.searchParams.get("sort_by") || "overall_score";
    const sortOrder = url.searchParams.get("sort_order") || "DESC";
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const conditions: string[] = [];
    const params: (string | number | boolean)[] = [];
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
    if (status) {
      conditions.push(`approach_status = $${paramIdx++}`);
      params.push(status);
    }
    if (pipeline) {
      conditions.push(`pipeline_stage = $${paramIdx++}`);
      params.push(pipeline);
    }
    if (hasWebsite === "true") {
      conditions.push("has_website = TRUE");
    } else if (hasWebsite === "false") {
      conditions.push("has_website = FALSE");
    }
    if (sessionId) {
      conditions.push(`scrape_session_id = $${paramIdx++}`);
      params.push(sessionId);
    }
    if (search) {
      conditions.push(
        `(business_name ILIKE $${paramIdx} OR address ILIKE $${paramIdx} OR category ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const allowedSort = [
      "overall_score",
      "seo_score",
      "gmb_score",
      "rating",
      "review_count",
      "created_at",
      "business_name",
    ];
    const safeSortBy = allowedSort.includes(sortBy) ? sortBy : "overall_score";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM leads ${whereClause}`,
      params
    );

    const leadsParams = [...params, limit, offset];
    const leads = await query(
      `SELECT * FROM leads ${whereClause} ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      leadsParams
    );

    return NextResponse.json({
      leads,
      total: parseInt(countResult?.count || "0"),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Leads fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500 }
    );
  }
}
