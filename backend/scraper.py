"""Browser-based Google Maps scraper using Playwright."""

import asyncio
import json
import re
import logging
from datetime import datetime, timezone
from urllib.parse import quote_plus, urlparse

from playwright.async_api import async_playwright, Page, Browser, TimeoutError as PWTimeout
from bs4 import BeautifulSoup
import httpx

logger = logging.getLogger(__name__)

# Words that indicate the scraper grabbed a UI element, not a real business
BLACKLISTED_NAMES = {
    "results", "result", "google maps", "map", "search", "sponsored",
    "ads", "advertisement", "see more", "more places", "explore",
    "update results", "undo", "show list",
}


class GoogleMapsScraper:
    """Scrapes Google Maps search results using a headless browser."""

    def __init__(self):
        self.browser: Browser | None = None
        self.context = None
        self._pw = None

    async def start(self):
        self._pw = await async_playwright().start()
        self.browser = await self._pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )
        self.context = await self.browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self._pw:
            await self._pw.stop()

    @staticmethod
    def _is_valid_business_name(name: str) -> bool:
        """Check if extracted text is a real business name."""
        if not name or len(name.strip()) < 2:
            return False
        if name.strip().lower() in BLACKLISTED_NAMES:
            return False
        if len(name) > 200:
            return False
        return True

    async def _dismiss_consent(self, page: Page):
        """Dismiss Google cookie / consent dialogs."""
        for selector in [
            'button:has-text("Accept all")',
            'button:has-text("Reject all")',
            'button:has-text("I agree")',
            'form[action*="consent"] button',
        ]:
            try:
                btn = page.locator(selector)
                if await btn.count() > 0:
                    await btn.first.click(timeout=3000)
                    await asyncio.sleep(1)
                    return
            except Exception:
                continue

    async def scrape_businesses(
        self,
        niche: str,
        area: str,
        module: str = "all_businesses",
        existing_gmb_links: set[str] | None = None,
        progress_callback=None,
        max_results: int = 100,
    ) -> list[dict]:
        """
        Scrape Google Maps for businesses.
        module: 'no_website' or 'all_businesses'

        Strategy:
          1. Load search results and scroll to collect place URLs.
          2. Open each place URL in a new page to extract details.
        """
        if existing_gmb_links is None:
            existing_gmb_links = set()

        query = f"{niche} in {area}"
        search_url = f"https://www.google.com/maps/search/{quote_plus(query)}"

        page = await self.context.new_page()
        businesses = []

        try:
            # ── Step 1: Load search results ──────────────────────────
            if progress_callback:
                await progress_callback({
                    "stage": "loading",
                    "total": 0,
                    "scraped": 0,
                    "skipped": 0,
                })

            await page.goto(search_url, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(3)

            await self._dismiss_consent(page)

            # Wait for the results feed to appear
            feed = page.locator('div[role="feed"]')
            try:
                await feed.wait_for(state="attached", timeout=15000)
            except PWTimeout:
                logger.warning("Results feed not found, trying alternative container")
                feed = page.locator('div[role="main"]')
                try:
                    await feed.wait_for(state="attached", timeout=10000)
                except PWTimeout:
                    logger.error("Could not find results container at all")
                    return businesses

            # ── Step 2: Scroll to load listings ──────────────────────
            collected_urls: list[str] = []
            seen_urls: set[str] = set()
            stale_rounds = 0
            max_stale = 8

            while stale_rounds < max_stale and len(collected_urls) < max_results:
                # Collect all place links currently visible
                links = page.locator('a[href*="/maps/place/"]')
                link_count = await links.count()
                new_found = 0
                for idx in range(link_count):
                    try:
                        href = await links.nth(idx).get_attribute("href")
                        if href and href not in seen_urls:
                            seen_urls.add(href)
                            collected_urls.append(href)
                            new_found += 1
                    except Exception:
                        continue

                if new_found == 0:
                    stale_rounds += 1
                else:
                    stale_rounds = 0

                if len(collected_urls) >= max_results:
                    break

                # Check for end-of-list marker
                end_marker = page.locator(
                    'span.HlvSq, p.fontBodyMedium:has-text("end of list"), '
                    'span:has-text("You\'ve reached the end")'
                )
                if await end_marker.count() > 0:
                    logger.info("Reached end of results list")
                    break

                # Scroll down inside the feed
                try:
                    await feed.evaluate("el => el.scrollTop = el.scrollTop + 1000")
                except Exception:
                    try:
                        await page.mouse.wheel(0, 1000)
                    except Exception:
                        pass
                await asyncio.sleep(1.5)

            await page.close()

            # Trim to max_results
            collected_urls = collected_urls[:max_results]

            if progress_callback:
                await progress_callback({
                    "stage": "found_listings",
                    "total": len(collected_urls),
                    "scraped": 0,
                    "skipped": 0,
                })

            logger.info(f"Collected {len(collected_urls)} place URLs for '{query}'")

            # ── Step 3: Visit each place page and extract details ────
            skipped = 0
            for i, place_url in enumerate(collected_urls):
                try:
                    # Duplicate detection by URL
                    if place_url in existing_gmb_links:
                        skipped += 1
                        if progress_callback:
                            await progress_callback({
                                "stage": "scraping",
                                "current": i + 1,
                                "total": len(collected_urls),
                                "skipped": skipped,
                                "scraped": len(businesses),
                            })
                        continue

                    detail_page = await self.context.new_page()
                    try:
                        biz = await self._extract_from_place_page(
                            detail_page, place_url
                        )
                    finally:
                        await detail_page.close()

                    if biz:
                        # Apply module filter
                        if module == "no_website" and biz.get("website"):
                            skipped += 1
                        else:
                            businesses.append(biz)
                    else:
                        skipped += 1

                    if progress_callback:
                        await progress_callback({
                            "stage": "scraping",
                            "current": i + 1,
                            "total": len(collected_urls),
                            "skipped": skipped,
                            "scraped": len(businesses),
                        })

                except Exception as e:
                    logger.warning(f"Error processing listing {i}: {e}")
                    skipped += 1
                    continue

        except Exception as e:
            logger.error(f"Scraping error: {e}", exc_info=True)
        finally:
            if not page.is_closed():
                await page.close()

        return businesses

    async def _extract_from_place_page(
        self, page: Page, place_url: str
    ) -> dict | None:
        """Navigate to a Google Maps place URL and extract business details."""
        try:
            await page.goto(place_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)

            await self._dismiss_consent(page)

            # Wait for the business name (h1) to appear
            try:
                await page.locator("h1").first.wait_for(state="visible", timeout=10000)
            except PWTimeout:
                logger.warning(f"h1 not visible for {place_url}")
                return None

            await asyncio.sleep(1)

            return await self._extract_business_details(page, place_url)

        except PWTimeout:
            logger.warning(f"Timeout loading place page: {place_url}")
            return None
        except Exception as e:
            logger.warning(f"Error loading place page: {e}")
            return None

    async def _extract_business_details(self, page: Page, gmb_link: str) -> dict | None:
        """Extract business details from the currently loaded place page."""
        try:
            details = {
                "gmb_link": gmb_link,
                "business_name": "",
                "phone": "",
                "email": "",
                "website": "",
                "has_website": False,
                "address": "",
                "category": "",
                "rating": None,
                "review_count": None,
            }

            # ── Business name ────────────────────────────────────────
            name = ""
            try:
                h1 = page.locator("h1")
                h1_count = await h1.count()
                for idx in range(h1_count):
                    text = (await h1.nth(idx).inner_text()).strip()
                    if self._is_valid_business_name(text):
                        name = text
                        break
            except Exception:
                pass

            if not name:
                # Fallback: try aria-label of the main section
                try:
                    main = page.locator('div[role="main"][aria-label]')
                    if await main.count() > 0:
                        label = await main.first.get_attribute("aria-label")
                        if label and self._is_valid_business_name(label):
                            name = label.strip()
                except Exception:
                    pass

            if not name:
                return None

            details["business_name"] = name

            # ── Category ─────────────────────────────────────────────
            try:
                cat_btn = page.locator('button[jsaction*="category"]')
                if await cat_btn.count() > 0:
                    details["category"] = (await cat_btn.first.inner_text()).strip()
            except Exception:
                pass

            if not details["category"]:
                try:
                    # Alternative: category text near the rating
                    cat_span = page.locator('span.DkEaL')
                    if await cat_span.count() > 0:
                        details["category"] = (await cat_span.first.inner_text()).strip()
                except Exception:
                    pass

            # ── Rating ───────────────────────────────────────────────
            try:
                # Try the structured rating element first
                rating_el = page.locator('div.F7nice span[aria-hidden="true"]').first
                if await rating_el.count() > 0:
                    rating_text = (await rating_el.inner_text()).strip()
                    details["rating"] = float(rating_text)
            except (ValueError, Exception):
                pass

            if details["rating"] is None:
                try:
                    # Fallback: aria-label on the stars
                    stars = page.locator('span[role="img"][aria-label*="star"]')
                    if await stars.count() > 0:
                        label = await stars.first.get_attribute("aria-label")
                        if label:
                            m = re.search(r'([\d.]+)', label)
                            if m:
                                details["rating"] = float(m.group(1))
                except Exception:
                    pass

            # ── Review count ─────────────────────────────────────────
            try:
                review_el = page.locator(
                    'div.F7nice span[aria-label*="review"]'
                ).first
                if await review_el.count() > 0:
                    aria = await review_el.get_attribute("aria-label")
                    if aria:
                        nums = re.findall(r'[\d,]+', aria)
                        if nums:
                            details["review_count"] = int(nums[0].replace(",", ""))
            except Exception:
                pass

            if details["review_count"] is None:
                try:
                    # Fallback: look for parenthesized review count text
                    review_text = page.locator('span:has-text("review")')
                    if await review_text.count() > 0:
                        txt = await review_text.first.inner_text()
                        m = re.search(r'([\d,]+)\s*review', txt, re.IGNORECASE)
                        if m:
                            details["review_count"] = int(
                                m.group(1).replace(",", "")
                            )
                except Exception:
                    pass

            # ── Address, Phone, Website from action buttons ──────────
            try:
                info_items = page.locator(
                    'button[data-item-id], a[data-item-id]'
                )
                count = await info_items.count()
                for j in range(count):
                    try:
                        el = info_items.nth(j)
                        data_id = (await el.get_attribute("data-item-id") or "").lower()
                        aria = await el.get_attribute("aria-label") or ""

                        if data_id.startswith("address") or "address" in aria.lower():
                            details["address"] = (
                                aria.replace("Address:", "")
                                .replace("Address", "")
                                .strip()
                            )
                            if not details["address"]:
                                details["address"] = (await el.inner_text()).strip()

                        elif data_id.startswith("phone") or "phone" in aria.lower():
                            phone = (
                                aria.replace("Phone:", "")
                                .replace("Phone", "")
                                .strip()
                            )
                            if not phone:
                                phone = (await el.inner_text()).strip()
                            details["phone"] = phone

                        elif data_id == "authority" or "website" in data_id:
                            website = (
                                aria.replace("Website:", "")
                                .replace("Website", "")
                                .strip()
                            )
                            if not website:
                                website = (await el.inner_text()).strip()
                            if website and not website.startswith("http"):
                                website = "https://" + website
                            details["website"] = website
                            details["has_website"] = True
                    except Exception:
                        continue
            except Exception:
                pass

            # If we still don't have an address, try the area from niche/area
            if not details["address"]:
                try:
                    addr_div = page.locator(
                        'div[data-attrid="kc:/location/location:address"]'
                    )
                    if await addr_div.count() > 0:
                        details["address"] = (await addr_div.inner_text()).strip()
                except Exception:
                    pass

            return details

        except Exception as e:
            logger.warning(f"Detail extraction error: {e}")
            return None

    async def scrape_gmb_link(self, gmb_link: str) -> dict | None:
        """Scrape a single GMB link for business details."""
        page = await self.context.new_page()
        try:
            await page.goto(
                gmb_link, wait_until="domcontentloaded", timeout=30000
            )
            await asyncio.sleep(3)

            await self._dismiss_consent(page)

            # Wait for h1 to load
            try:
                await page.locator("h1").first.wait_for(
                    state="visible", timeout=10000
                )
            except PWTimeout:
                logger.warning("h1 not visible for GMB link")

            await asyncio.sleep(1)
            return await self._extract_business_details(page, gmb_link)
        except Exception as e:
            logger.error(f"GMB link scrape error: {e}")
            return None
        finally:
            await page.close()


class WebsiteAnalyzer:
    """Analyzes a business website for SEO optimization."""

    @staticmethod
    async def analyze(website_url: str) -> dict:
        """Perform SEO and quality analysis on a website."""
        result = {
            "seo_score": 0,
            "gmb_score": 0,
            "has_old_website": False,
            "is_seo_optimized": False,
            "issues": [],
            "recommendations": [],
        }

        if not website_url:
            return result

        try:
            async with httpx.AsyncClient(
                timeout=20, follow_redirects=True,
                verify=False,
                headers={"User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)"}
            ) as client:
                resp = await client.get(website_url)
                html = resp.text
                soup = BeautifulSoup(html, "html.parser")

                seo_points = 0
                max_points = 100

                # 1. Title tag (10 pts)
                title = soup.find("title")
                if title and title.string and len(title.string.strip()) > 10:
                    seo_points += 10
                else:
                    result["issues"].append("Missing or short title tag")
                    result["recommendations"].append(
                        "Add a descriptive title tag (50-60 chars)"
                    )

                # 2. Meta description (10 pts)
                meta_desc = soup.find("meta", attrs={"name": "description"})
                if meta_desc and meta_desc.get("content", "").strip():
                    desc = meta_desc["content"].strip()
                    if len(desc) > 50:
                        seo_points += 10
                    else:
                        seo_points += 5
                        result["issues"].append("Meta description is too short")
                else:
                    result["issues"].append("Missing meta description")
                    result["recommendations"].append(
                        "Add meta description (150-160 chars)"
                    )

                # 3. H1 tag (10 pts)
                h1 = soup.find("h1")
                if h1:
                    seo_points += 10
                else:
                    result["issues"].append("Missing H1 tag")
                    result["recommendations"].append("Add a single H1 tag")

                # 4. Header hierarchy (5 pts)
                h2_tags = soup.find_all("h2")
                if len(h2_tags) >= 2:
                    seo_points += 5
                else:
                    result["issues"].append("Few or no H2 tags")

                # 5. Image alt tags (10 pts)
                images = soup.find_all("img")
                if images:
                    imgs_with_alt = sum(1 for img in images if img.get("alt"))
                    alt_ratio = imgs_with_alt / len(images)
                    seo_points += int(alt_ratio * 10)
                    if alt_ratio < 0.5:
                        result["issues"].append(
                            f"Only {int(alt_ratio*100)}% images have alt tags"
                        )
                        result["recommendations"].append(
                            "Add alt text to all images"
                        )
                else:
                    seo_points += 5

                # 6. Mobile viewport (10 pts)
                viewport = soup.find("meta", attrs={"name": "viewport"})
                if viewport:
                    seo_points += 10
                else:
                    result["issues"].append("Missing viewport meta tag")
                    result["recommendations"].append(
                        "Add viewport meta tag for mobile"
                    )
                    result["has_old_website"] = True

                # 7. HTTPS (5 pts)
                if website_url.startswith("https"):
                    seo_points += 5
                else:
                    result["issues"].append("Website not using HTTPS")
                    result["recommendations"].append("Migrate to HTTPS")

                # 8. Schema markup / structured data (10 pts)
                schemas = soup.find_all("script", type="application/ld+json")
                if schemas:
                    seo_points += 10
                else:
                    result["issues"].append(
                        "No structured data / schema markup"
                    )
                    result["recommendations"].append(
                        "Add LocalBusiness schema markup"
                    )

                # 9. Page speed indicators (10 pts)
                scripts = soup.find_all("script")
                stylesheets = soup.find_all("link", rel="stylesheet")
                if len(scripts) < 15 and len(stylesheets) < 10:
                    seo_points += 10
                elif len(scripts) < 25:
                    seo_points += 5
                    result["issues"].append("Too many scripts loaded")
                else:
                    result["issues"].append(
                        "Excessive scripts may slow page load"
                    )
                    result["recommendations"].append(
                        "Optimize and reduce JS bundles"
                    )

                # 10. Internal links (5 pts)
                links = soup.find_all("a", href=True)
                domain = urlparse(website_url).netloc
                internal = [
                    l for l in links
                    if domain in (urlparse(l["href"]).netloc or domain)
                ]
                if len(internal) >= 3:
                    seo_points += 5
                else:
                    result["issues"].append("Very few internal links")

                # 11. Social links (5 pts)
                social_domains = [
                    "facebook.com", "twitter.com", "instagram.com",
                    "linkedin.com", "youtube.com", "tiktok.com", "x.com",
                ]
                social_found = []
                for link in links:
                    href = link.get("href", "")
                    for sd in social_domains:
                        if sd in href:
                            social_found.append(sd)
                if social_found:
                    seo_points += 5
                else:
                    result["issues"].append("No social media links found")
                    result["recommendations"].append(
                        "Add links to social media profiles"
                    )

                # 12. Contact info (5 pts)
                page_text = soup.get_text()
                has_phone = bool(
                    re.search(r'[\(\+]?\d[\d\-\(\) ]{7,}\d', page_text)
                )
                has_email_on_page = bool(
                    re.search(
                        r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
                        page_text,
                    )
                )
                if has_phone or has_email_on_page:
                    seo_points += 5
                else:
                    result["issues"].append(
                        "No visible contact info on website"
                    )

                # 13. Detect old/outdated website indicators (5 pts)
                flash_embeds = soup.find_all(
                    "embed",
                    type=lambda x: x and "flash" in x.lower(),
                )
                table_layout = len(soup.find_all("table")) > 5
                if flash_embeds or table_layout:
                    result["has_old_website"] = True
                    result["issues"].append(
                        "Website appears to use outdated technologies"
                    )
                    result["recommendations"].append(
                        "Modernize website with current standards"
                    )
                else:
                    seo_points += 5

                # Check copyright year
                copyright_match = re.search(r'©\s*(\d{4})', page_text)
                if copyright_match:
                    year = int(copyright_match.group(1))
                    if year < 2022:
                        result["has_old_website"] = True
                        result["issues"].append(
                            f"Copyright year is {year}, website may be outdated"
                        )

                result["seo_score"] = min(seo_points, max_points)
                result["is_seo_optimized"] = seo_points >= 70

                # Extract email from website
                emails = re.findall(
                    r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
                    page_text,
                )
                filtered = [
                    e for e in emails
                    if not e.endswith(('.png', '.jpg', '.gif', '.svg'))
                ]
                if filtered:
                    result["email"] = filtered[0]

        except Exception as e:
            result["issues"].append(f"Could not analyze website: {str(e)}")
            result["recommendations"].append("Verify website is accessible")

        return result

    @staticmethod
    def analyze_gmb(biz: dict) -> dict:
        """Score GMB profile optimization."""
        score = 0
        issues = []
        recommendations = []

        if biz.get("business_name"):
            score += 10
        else:
            issues.append("Missing business name")

        if biz.get("phone"):
            score += 15
        else:
            issues.append("No phone number on GMB")
            recommendations.append("Add phone number to GMB profile")

        if biz.get("website"):
            score += 15
        else:
            issues.append("No website linked on GMB")
            recommendations.append("Add website to GMB profile")

        if biz.get("address"):
            score += 10
        else:
            issues.append("No address on GMB")

        if biz.get("category"):
            score += 10
        else:
            issues.append("No business category set")
            recommendations.append("Set appropriate business category")

        rating = biz.get("rating")
        if rating is not None:
            if rating >= 4.5:
                score += 20
            elif rating >= 4.0:
                score += 15
            elif rating >= 3.0:
                score += 10
            else:
                score += 5
                recommendations.append("Improve customer ratings")
        else:
            issues.append("No ratings yet")
            recommendations.append("Encourage customers to leave reviews")

        reviews = biz.get("review_count", 0) or 0
        if reviews >= 50:
            score += 20
        elif reviews >= 20:
            score += 15
        elif reviews >= 10:
            score += 10
        elif reviews >= 1:
            score += 5
        else:
            issues.append("No reviews")
            recommendations.append("Get more customer reviews")

        return {
            "gmb_score": score,
            "is_gmb_optimized": score >= 70,
            "gmb_issues": issues,
            "gmb_recommendations": recommendations,
        }


class OwnerFinder:
    """Attempts to find business owner information via search."""

    @staticmethod
    async def find_owner(
        business_name: str, website: str, page: Page
    ) -> dict:
        """Search for owner/CEO info using Google search tricks."""
        owner_info = {
            "owner_name": "",
            "owner_linkedin": "",
            "owner_social": "",
        }

        if not website and not business_name:
            return owner_info

        search_queries = []
        domain = ""
        if website:
            domain = (
                urlparse(website).netloc
                or website.replace("https://", "")
                .replace("http://", "")
                .split("/")[0]
            )

        if domain:
            search_queries.append(
                f'"CEO" OR "owner" OR "founder" site:{domain}'
            )
            search_queries.append(
                f'{domain} CEO OR owner OR founder linkedin.com'
            )
        if business_name:
            search_queries.append(
                f'"{business_name}" CEO OR owner OR founder'
            )
            search_queries.append(f'"{business_name}" site:linkedin.com')

        for query in search_queries[:2]:
            try:
                search_url = (
                    f"https://www.google.com/search?q={quote_plus(query)}"
                )
                await page.goto(
                    search_url, wait_until="domcontentloaded", timeout=15000
                )
                await asyncio.sleep(2)

                content = await page.content()
                soup = BeautifulSoup(content, "html.parser")

                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if "linkedin.com/in/" in href:
                        linkedin_url = href
                        if "/url?q=" in linkedin_url:
                            linkedin_url = (
                                linkedin_url.split("/url?q=")[1].split("&")[0]
                            )
                        owner_info["owner_linkedin"] = linkedin_url

                        text = a.get_text(strip=True)
                        if text and "-" in text:
                            name = text.split("-")[0].strip()
                            if len(name.split()) <= 4:
                                owner_info["owner_name"] = name
                        break

                socials = {}
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    for platform in [
                        "facebook.com",
                        "twitter.com",
                        "x.com",
                        "instagram.com",
                    ]:
                        if platform in href and platform not in socials:
                            clean_url = href
                            if "/url?q=" in clean_url:
                                clean_url = (
                                    clean_url.split("/url?q=")[1].split("&")[0]
                                )
                            socials[platform] = clean_url

                if socials:
                    owner_info["owner_social"] = json.dumps(socials)

                if owner_info["owner_name"] or owner_info["owner_linkedin"]:
                    break

            except Exception as e:
                logger.warning(f"Owner search error: {e}")
                continue

        return owner_info
