import * as cheerio from "cheerio";
import type { AuditReport } from "@/types";

interface AnalysisResult {
  seo_score: number;
  website_score: number;
  issues_count: number;
  has_ssl: boolean;
  has_mobile_viewport: boolean;
  has_schema: boolean;
  page_speed: number | null;
  audit_report: AuditReport;
}

export async function analyzeWebsite(url: string): Promise<AnalysisResult> {
  const report: AuditReport = {
    ssl: { passed: false, detail: "Could not check" },
    mobile_viewport: { passed: false, detail: "No viewport meta tag found" },
    meta_title: { passed: false, detail: "No title tag found" },
    meta_description: { passed: false, detail: "No meta description found" },
    h1_tag: { passed: false, detail: "No H1 tag found" },
    schema_markup: { passed: false, detail: "No schema markup found" },
    page_speed: { score: 0, detail: "Could not measure" },
    https_redirect: { passed: false, detail: "Site does not use HTTPS" },
    image_alt_tags: { passed: false, detail: "Could not check" },
    canonical_tag: { passed: false, detail: "No canonical tag found" },
    robots_txt: { passed: false, detail: "No robots.txt found" },
    sitemap: { passed: false, detail: "No sitemap found" },
    open_graph: { passed: false, detail: "No Open Graph tags found" },
  };

  let issueCount = 0;
  let passedChecks = 0;
  const totalChecks = 13;

  try {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    const parsedUrl = new URL(normalizedUrl);

    // SSL Check
    if (parsedUrl.protocol === "https:") {
      report.ssl.passed = true;
      report.ssl.detail = "Site uses HTTPS";
      report.https_redirect.passed = true;
      report.https_redirect.detail = "Site uses HTTPS";
      passedChecks += 2;
    } else {
      issueCount += 2;
    }

    // Fetch the page
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const startTime = Date.now();
    let response: Response;
    try {
      response = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });
    } catch {
      clearTimeout(timeout);
      return buildResult(report, 0, totalChecks, issueCount, false, false, false, null);
    }
    const loadTime = (Date.now() - startTime) / 1000;
    clearTimeout(timeout);

    const html = await response.text();
    const $ = cheerio.load(html);

    // Page speed estimation
    const speedScore = loadTime <= 2 ? 90 : loadTime <= 4 ? 70 : loadTime <= 6 ? 50 : loadTime <= 8 ? 30 : 10;
    report.page_speed.score = speedScore;
    report.page_speed.detail = `Page loaded in ${loadTime.toFixed(1)}s`;
    if (speedScore >= 50) passedChecks++;
    else issueCount++;

    // Meta title
    const title = $("title").text().trim();
    if (title && title.length > 0) {
      report.meta_title.passed = true;
      report.meta_title.detail = `Title: "${title.substring(0, 60)}"`;
      report.meta_title.value = title;
      passedChecks++;
    } else {
      report.meta_title.detail = "Missing title tag - critical for SEO";
      issueCount++;
    }

    // Meta description
    const metaDesc =
      $('meta[name="description"]').attr("content") || "";
    if (metaDesc.length > 0) {
      report.meta_description.passed = true;
      report.meta_description.detail = `Description: "${metaDesc.substring(0, 80)}..."`;
      report.meta_description.value = metaDesc;
      passedChecks++;
    } else {
      report.meta_description.detail =
        "Missing meta description - important for search results";
      issueCount++;
    }

    // H1 tag
    const h1Count = $("h1").length;
    if (h1Count === 1) {
      report.h1_tag.passed = true;
      report.h1_tag.detail = "Single H1 tag found";
      report.h1_tag.count = 1;
      passedChecks++;
    } else if (h1Count > 1) {
      report.h1_tag.detail = `${h1Count} H1 tags found - should have exactly 1`;
      report.h1_tag.count = h1Count;
      issueCount++;
    } else {
      report.h1_tag.detail = "No H1 tag found - important for page structure";
      report.h1_tag.count = 0;
      issueCount++;
    }

    // Mobile viewport
    const viewport = $('meta[name="viewport"]').attr("content") || "";
    if (viewport.includes("width=")) {
      report.mobile_viewport.passed = true;
      report.mobile_viewport.detail = "Viewport meta tag configured";
      passedChecks++;
    } else {
      report.mobile_viewport.detail =
        "No mobile viewport - site may not be mobile-friendly";
      issueCount++;
    }

    // Schema markup
    const schemaScripts = $('script[type="application/ld+json"]');
    const hasItemScope = $("[itemscope]").length > 0;
    if (schemaScripts.length > 0 || hasItemScope) {
      report.schema_markup.passed = true;
      report.schema_markup.detail = "Schema markup found";
      passedChecks++;
    } else {
      report.schema_markup.detail =
        "No structured data - missing rich snippet opportunities";
      issueCount++;
    }

    // Image alt tags
    const images = $("img");
    const imagesWithoutAlt = images.filter(
      (_, el) => !$(el).attr("alt")
    ).length;
    if (images.length === 0 || imagesWithoutAlt === 0) {
      report.image_alt_tags.passed = true;
      report.image_alt_tags.detail = "All images have alt tags";
      passedChecks++;
    } else {
      report.image_alt_tags.detail = `${imagesWithoutAlt} images missing alt tags`;
      report.image_alt_tags.missing = imagesWithoutAlt;
      issueCount++;
    }

    // Canonical tag
    const canonical = $('link[rel="canonical"]').attr("href");
    if (canonical) {
      report.canonical_tag.passed = true;
      report.canonical_tag.detail = "Canonical tag found";
      passedChecks++;
    } else {
      report.canonical_tag.detail = "No canonical tag - may cause duplicate content issues";
      issueCount++;
    }

    // Open Graph tags
    const ogTitle = $('meta[property="og:title"]').attr("content");
    const ogDesc = $('meta[property="og:description"]').attr("content");
    if (ogTitle || ogDesc) {
      report.open_graph.passed = true;
      report.open_graph.detail = "Open Graph tags found";
      passedChecks++;
    } else {
      report.open_graph.detail =
        "No Open Graph tags - social sharing will look poor";
      issueCount++;
    }

    // Robots.txt check
    try {
      const robotsUrl = `${parsedUrl.origin}/robots.txt`;
      const robotsResp = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (robotsResp.ok) {
        const robotsText = await robotsResp.text();
        if (robotsText.toLowerCase().includes("user-agent")) {
          report.robots_txt.passed = true;
          report.robots_txt.detail = "robots.txt found and valid";
          passedChecks++;
        } else {
          report.robots_txt.detail = "robots.txt exists but may be empty";
          issueCount++;
        }
      } else {
        issueCount++;
      }
    } catch {
      issueCount++;
    }

    // Sitemap check
    try {
      const sitemapUrl = `${parsedUrl.origin}/sitemap.xml`;
      const sitemapResp = await fetch(sitemapUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (sitemapResp.ok) {
        report.sitemap.passed = true;
        report.sitemap.detail = "sitemap.xml found";
        passedChecks++;
      } else {
        report.sitemap.detail = "No sitemap.xml found";
        issueCount++;
      }
    } catch {
      report.sitemap.detail = "Could not check sitemap";
      issueCount++;
    }

    const seoScore = Math.round((passedChecks / totalChecks) * 100);

    return buildResult(
      report,
      seoScore,
      totalChecks,
      issueCount,
      report.ssl.passed,
      report.mobile_viewport.passed,
      report.schema_markup.passed,
      speedScore
    );
  } catch {
    return buildResult(report, 0, totalChecks, totalChecks, false, false, false, null);
  }
}

function buildResult(
  audit_report: AuditReport,
  seo_score: number,
  _totalChecks: number,
  issues_count: number,
  has_ssl: boolean,
  has_mobile_viewport: boolean,
  has_schema: boolean,
  page_speed: number | null
): AnalysisResult {
  const website_score = seo_score;
  return {
    seo_score,
    website_score,
    issues_count,
    has_ssl,
    has_mobile_viewport,
    has_schema,
    page_speed,
    audit_report,
  };
}

export function analyzeGMB(business: {
  rating: number | null;
  review_count: number | null;
  category: string;
  phone: string;
  address: string;
}): number {
  let score = 0;
  const maxScore = 100;

  // Rating component (30 points)
  if (business.rating !== null) {
    if (business.rating >= 4.5) score += 10;
    else if (business.rating >= 4.0) score += 20;
    else if (business.rating >= 3.0) score += 30;
    else score += 30; // Low rating = bigger opportunity
  } else {
    score += 25; // No rating = opportunity
  }

  // Review count (25 points)
  if (business.review_count !== null) {
    if (business.review_count === 0) score += 25;
    else if (business.review_count < 10) score += 20;
    else if (business.review_count < 50) score += 15;
    else score += 5;
  } else {
    score += 20;
  }

  // Category presence (15 points)
  if (!business.category || business.category.length === 0) {
    score += 15;
  } else {
    score += 5;
  }

  // Contact info (15 points)
  if (!business.phone) score += 10;
  if (!business.address) score += 5;

  // Normalize to percentage
  return Math.min(Math.round((score / maxScore) * 100), 100);
}

export function calculateOverallScore(
  seoScore: number,
  gmbScore: number,
  rating: number | null,
  reviewCount: number | null
): { score: number; leadType: "hot" | "warm" | "cold" | "new" } {
  // Weighted: SEO 40%, GMB 30%, Reviews opportunity 30%
  let reviewOpportunity = 50;
  if (rating !== null) {
    reviewOpportunity = rating <= 3.0 ? 80 : rating <= 4.0 ? 50 : 20;
  }
  if (reviewCount !== null) {
    if (reviewCount < 5) reviewOpportunity += 20;
    else if (reviewCount < 20) reviewOpportunity += 10;
  }
  reviewOpportunity = Math.min(reviewOpportunity, 100);

  const overall = Math.round(
    seoScore * 0.4 + gmbScore * 0.3 + reviewOpportunity * 0.3
  );

  let leadType: "hot" | "warm" | "cold" | "new" = "new";
  if (overall >= 70) leadType = "hot";
  else if (overall >= 40) leadType = "warm";
  else leadType = "cold";

  return { score: overall, leadType };
}
