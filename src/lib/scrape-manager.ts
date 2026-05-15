import { v4 as uuidv4 } from "uuid";
import { query } from "./db";
import { scrapeGoogleMaps, type ScrapeProgressData } from "./scraper";
import { analyzeWebsite, analyzeGMB, calculateOverallScore } from "./analyzer";

// In-memory progress tracking
const progressMap = new Map<string, ScrapeProgressData>();

export function getProgress(sessionId: string): ScrapeProgressData | null {
  return progressMap.get(sessionId) || null;
}

export async function startScrapeSession(
  niche: string,
  area: string,
  maxResults: number = 20
): Promise<string> {
  const sessionId = uuidv4();

  await query(
    `INSERT INTO scrape_sessions (id, niche, area, status) VALUES ($1, $2, $3, 'running')`,
    [sessionId, niche, area]
  );

  progressMap.set(sessionId, {
    stage: "starting",
    total: 0,
    scraped: 0,
    skipped: 0,
  });

  // Get existing GMB links for dedup
  const existing = await query<{ gmb_link: string }>(
    `SELECT gmb_link FROM leads WHERE niche = $1 AND area = $2 AND gmb_link != ''`,
    [niche, area]
  );
  const existingLinks = new Set(existing.map((e) => e.gmb_link));

  // Existing names for dedup
  const existingNames = await query<{ name: string }>(
    `SELECT LOWER(business_name) as name FROM leads WHERE area = $1`,
    [area]
  );
  const existingNameSet = new Set(existingNames.map((e) => e.name));

  // Run scraping in background
  runScrape(sessionId, niche, area, existingLinks, existingNameSet, maxResults).catch(
    async (err) => {
      console.error("Scrape error:", err);
      await query(
        `UPDATE scrape_sessions SET status = 'failed' WHERE id = $1`,
        [sessionId]
      );
      progressMap.set(sessionId, {
        stage: "error",
        total: 0,
        scraped: 0,
        skipped: 0,
      });
    }
  );

  return sessionId;
}

async function runScrape(
  sessionId: string,
  niche: string,
  area: string,
  existingLinks: Set<string>,
  existingNameSet: Set<string>,
  maxResults: number
): Promise<void> {
  const businesses = await scrapeGoogleMaps(
    niche,
    area,
    existingLinks,
    (data) => {
      progressMap.set(sessionId, data);
    },
    maxResults
  );

  // Update progress
  progressMap.set(sessionId, {
    stage: "analyzing",
    total: businesses.length,
    scraped: 0,
    skipped: 0,
  });

  let savedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < businesses.length; i++) {
    const biz = businesses[i];

    // Skip duplicates by name
    if (existingNameSet.has(biz.business_name.toLowerCase())) {
      skippedCount++;
      continue;
    }

    progressMap.set(sessionId, {
      stage: "analyzing",
      total: businesses.length,
      scraped: savedCount,
      skipped: skippedCount,
      current_business: biz.business_name,
    });

    // Analyze website
    let seoScore = 0;
    let websiteScore = 0;
    let issuesCount = 0;
    let hasSsl = false;
    let hasMobileViewport = false;
    let hasSchema = false;
    let pageSpeed: number | null = null;
    let auditReport = "{}";

    if (biz.website) {
      try {
        const analysis = await analyzeWebsite(biz.website);
        seoScore = analysis.seo_score;
        websiteScore = analysis.website_score;
        issuesCount = analysis.issues_count;
        hasSsl = analysis.has_ssl;
        hasMobileViewport = analysis.has_mobile_viewport;
        hasSchema = analysis.has_schema;
        pageSpeed = analysis.page_speed;
        auditReport = JSON.stringify(analysis.audit_report);
      } catch (err) {
        console.error(`Analysis error for ${biz.website}:`, err);
        auditReport = JSON.stringify({ error: "Could not analyze website" });
      }
    } else {
      // No website = big opportunity
      seoScore = 85;
      issuesCount = 13;
      auditReport = JSON.stringify({
        no_website: {
          passed: false,
          detail: "Business has no website - major opportunity for web development services",
        },
      });
    }

    // Analyze GMB
    const gmbScore = analyzeGMB({
      rating: biz.rating,
      review_count: biz.review_count,
      category: biz.category,
      phone: biz.phone,
      address: biz.address,
    });

    // Calculate overall score
    const { score: overallScore, leadType } = calculateOverallScore(
      seoScore,
      gmbScore,
      biz.rating,
      biz.review_count
    );

    const leadId = uuidv4();

    try {
      await query(
        `INSERT INTO leads (
          id, business_name, phone, email, website, has_website, address,
          area, niche, gmb_link, category, rating, review_count,
          seo_score, gmb_score, website_score, overall_score, lead_type,
          has_ssl, has_mobile_viewport, has_schema, page_speed, issues_count,
          audit_report, approach_status, pipeline_stage, notes, owner_name,
          scrape_session_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
          $24, $25, $26, $27, $28, $29
        ) ON CONFLICT DO NOTHING`,
        [
          leadId,
          biz.business_name,
          biz.phone,
          biz.email,
          biz.website,
          biz.has_website,
          biz.address,
          area,
          niche,
          biz.gmb_link,
          biz.category,
          biz.rating,
          biz.review_count,
          seoScore,
          gmbScore,
          websiteScore,
          overallScore,
          leadType,
          hasSsl,
          hasMobileViewport,
          hasSchema,
          pageSpeed,
          issuesCount,
          auditReport,
          "not_contacted",
          "new",
          "",
          "",
          sessionId,
        ]
      );
      savedCount++;
      existingNameSet.add(biz.business_name.toLowerCase());
    } catch (err) {
      console.error(`Error saving lead ${biz.business_name}:`, err);
      skippedCount++;
    }
  }

  // Update session
  await query(
    `UPDATE scrape_sessions SET status = 'completed', total_found = $1, total_scraped = $2, total_skipped = $3, completed_at = NOW() WHERE id = $4`,
    [businesses.length, savedCount, skippedCount, sessionId]
  );

  progressMap.set(sessionId, {
    stage: "completed",
    total: businesses.length,
    scraped: savedCount,
    skipped: skippedCount,
  });

  // Clean up progress after 5 minutes
  setTimeout(() => {
    progressMap.delete(sessionId);
  }, 300000);
}
