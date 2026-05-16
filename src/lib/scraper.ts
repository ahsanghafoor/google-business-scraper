import puppeteer, { Browser, Page } from "puppeteer";

const BLACKLISTED_NAMES = new Set([
  "results", "result", "google maps", "map", "search", "sponsored",
  "ads", "advertisement", "see more", "more places", "explore",
  "update results", "undo", "show list",
]);

function isValidBusinessName(name: string): boolean {
  if (!name || name.trim().length < 2) return false;
  if (BLACKLISTED_NAMES.has(name.trim().toLowerCase())) return false;
  if (name.length > 200) return false;
  return true;
}

export interface ScrapedBusiness {
  business_name: string;
  phone: string;
  email: string;
  website: string;
  has_website: boolean;
  address: string;
  gmb_link: string;
  category: string;
  rating: number | null;
  review_count: number | null;
}

export interface ScrapeProgressData {
  stage: string;
  total: number;
  scraped: number;
  skipped: number;
  current_business?: string;
}

export type ProgressCallback = (data: ScrapeProgressData) => void;

async function dismissConsent(page: Page): Promise<void> {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("Reject all")',
    'button:has-text("I agree")',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await new Promise((r) => setTimeout(r, 1000));
        return;
      }
    } catch {
      continue;
    }
  }
  // Try XPath-based approach for consent buttons
  try {
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const text = await btn.evaluate((el) => el.textContent?.trim().toLowerCase() || "");
      if (
        text.includes("accept all") ||
        text.includes("reject all") ||
        text.includes("i agree")
      ) {
        await btn.click();
        await new Promise((r) => setTimeout(r, 1000));
        return;
      }
    }
  } catch {
    // ignore
  }
}

async function extractBusinessDetails(
  page: Page,
  gmbLink: string
): Promise<ScrapedBusiness | null> {
  try {
    await page.goto(gmbLink, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await dismissConsent(page);

    // Wait for h1
    try {
      await page.waitForSelector("h1", { timeout: 10000 });
    } catch {
      return null;
    }

    await new Promise((r) => setTimeout(r, 1000));

    const details = await page.evaluate(() => {
      const result: Record<string, string | number | boolean | null> = {
        business_name: "",
        phone: "",
        email: "",
        website: "",
        has_website: false,
        address: "",
        category: "",
        rating: null,
        review_count: null,
      };

      // Business name
      const h1 = document.querySelector("h1");
      if (h1) result.business_name = h1.textContent?.trim() || "";

      // Category
      const catBtn = document.querySelector('button[jsaction*="category"]');
      if (catBtn) result.category = catBtn.textContent?.trim() || "";
      if (!result.category) {
        const catSpan = document.querySelector("span.DkEaL");
        if (catSpan) result.category = catSpan.textContent?.trim() || "";
      }

      // Rating
      const ratingEl = document.querySelector(
        'div.F7nice span[aria-hidden="true"]'
      );
      if (ratingEl) {
        const val = parseFloat(ratingEl.textContent?.trim() || "");
        if (!isNaN(val)) result.rating = val;
      }
      if (result.rating === null) {
        const stars = document.querySelector(
          'span[role="img"][aria-label*="star"]'
        );
        if (stars) {
          const label = stars.getAttribute("aria-label") || "";
          const match = label.match(/([\d.]+)/);
          if (match) result.rating = parseFloat(match[1]);
        }
      }

      // Review count
      const reviewEl = document.querySelector(
        'div.F7nice span[aria-label*="review"]'
      );
      if (reviewEl) {
        const aria = reviewEl.getAttribute("aria-label") || "";
        const nums = aria.match(/[\d,]+/);
        if (nums) result.review_count = parseInt(nums[0].replace(/,/g, ""), 10);
      }

      // Address, Phone, Website from info rows
      const infoButtons = document.querySelectorAll(
        'button[data-item-id], a[data-item-id]'
      );
      infoButtons.forEach((btn) => {
        const itemId = btn.getAttribute("data-item-id") || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const text = btn.textContent?.trim() || "";

        if (itemId === "address" || itemId.startsWith("address") || ariaLabel.toLowerCase().includes("address")) {
          result.address = text;
        } else if (itemId === "phone" || itemId.startsWith("phone") || ariaLabel.toLowerCase().includes("phone")) {
          result.phone = text;
        } else if (itemId === "authority" || itemId.startsWith("authority") || ariaLabel.toLowerCase().includes("website")) {
          const href = btn.getAttribute("href") || btn.querySelector("a")?.getAttribute("href") || "";
          if (href && href.startsWith("http")) {
            result.website = href;
            result.has_website = true;
          } else if (text && (text.startsWith("http") || text.includes("."))) {
            result.website = text.startsWith("http") ? text : `https://${text}`;
            result.has_website = true;
          }
        }
      });

      // Fallback website detection
      if (!result.website) {
        const allLinks = document.querySelectorAll('a[href]');
        allLinks.forEach((link) => {
          const ariaLabel = link.getAttribute("aria-label") || "";
          if (ariaLabel.toLowerCase().includes("website") || ariaLabel.toLowerCase().includes("open website")) {
            const href = link.getAttribute("href") || "";
            if (href && !href.includes("google.com") && href.startsWith("http")) {
              result.website = href;
              result.has_website = true;
            }
          }
        });
      }

      return result;
    });

    if (!details.business_name || !isValidBusinessName(String(details.business_name))) {
      return null;
    }

    return {
      business_name: String(details.business_name),
      phone: String(details.phone || ""),
      email: String(details.email || ""),
      website: String(details.website || ""),
      has_website: Boolean(details.has_website),
      address: String(details.address || ""),
      gmb_link: gmbLink,
      category: String(details.category || ""),
      rating: details.rating !== null ? Number(details.rating) : null,
      review_count: details.review_count !== null ? Number(details.review_count) : null,
    };
  } catch (err) {
    console.error(`Error extracting details from ${gmbLink}:`, err);
    return null;
  }
}

function isValidBusinessName_standalone(name: string): boolean {
  return isValidBusinessName(name);
}

// Make available in page evaluate context
(globalThis as Record<string, unknown>).__isValidBusinessName = isValidBusinessName_standalone;

export async function scrapeGoogleMaps(
  niche: string,
  area: string,
  existingGmbLinks: Set<string>,
  progressCallback: ProgressCallback,
  maxResults: number = 20
): Promise<ScrapedBusiness[]> {
  let browser: Browser | null = null;
  const businesses: ScrapedBusiness[] = [];

  try {
    progressCallback({
      stage: "launching_browser",
      total: 0,
      scraped: 0,
      skipped: 0,
    });

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1920, height: 1080 });

    const query = `${niche} in ${area}`;
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    progressCallback({
      stage: "loading_results",
      total: 0,
      scraped: 0,
      skipped: 0,
    });

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));
    await dismissConsent(page);

    // Wait for results feed
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
    } catch {
      try {
        await page.waitForSelector('div[role="main"]', { timeout: 10000 });
      } catch {
        console.error("Could not find results container");
        await page.close();
        return businesses;
      }
    }

    // Scroll to collect place URLs
    const collectedUrls: string[] = [];
    const seenUrls = new Set<string>();
    let staleRounds = 0;
    const maxStale = 8;

    progressCallback({
      stage: "scrolling_results",
      total: 0,
      scraped: 0,
      skipped: 0,
    });

    while (staleRounds < maxStale && collectedUrls.length < maxResults) {
      const links = await page.$$eval(
        'a[href*="/maps/place/"]',
        (els) => els.map((el) => el.getAttribute("href")).filter(Boolean) as string[]
      );

      let newFound = 0;
      for (const href of links) {
        if (!seenUrls.has(href)) {
          seenUrls.add(href);
          collectedUrls.push(href);
          newFound++;
        }
      }

      if (newFound === 0) staleRounds++;
      else staleRounds = 0;

      if (collectedUrls.length >= maxResults) break;

      // Check for end marker
      const endReached = await page.evaluate(() => {
        const markers = document.querySelectorAll(
          'span.HlvSq, p.fontBodyMedium'
        );
        for (const m of markers) {
          const text = m.textContent?.toLowerCase() || "";
          if (text.includes("end of list") || text.includes("reached the end")) {
            return true;
          }
        }
        return false;
      });

      if (endReached) break;

      // Scroll inside the feed
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          feed.scrollTop += 1000;
        } else {
          window.scrollBy(0, 1000);
        }
      });
      await new Promise((r) => setTimeout(r, 1500));
    }

    await page.close();

    const urls = collectedUrls.slice(0, maxResults);

    progressCallback({
      stage: "found_listings",
      total: urls.length,
      scraped: 0,
      skipped: 0,
    });

    // Visit each place page
    let skipped = 0;
    for (let i = 0; i < urls.length; i++) {
      const placeUrl = urls[i];

      if (existingGmbLinks.has(placeUrl)) {
        skipped++;
        progressCallback({
          stage: "scraping",
          total: urls.length,
          scraped: businesses.length,
          skipped,
          current_business: "Skipping duplicate...",
        });
        continue;
      }

      try {
        const detailPage = await browser.newPage();
        await detailPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );

        const biz = await extractBusinessDetails(detailPage, placeUrl);
        await detailPage.close();

        if (biz) {
          businesses.push(biz);
          progressCallback({
            stage: "scraping",
            total: urls.length,
            scraped: businesses.length,
            skipped,
            current_business: biz.business_name,
          });
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Error processing listing ${i}:`, err);
        skipped++;
      }
    }

    progressCallback({
      stage: "completed",
      total: urls.length,
      scraped: businesses.length,
      skipped,
    });
  } catch (err) {
    console.error("Scraping error:", err);
    progressCallback({
      stage: "error",
      total: 0,
      scraped: businesses.length,
      skipped: 0,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return businesses;
}
