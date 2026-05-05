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


class GoogleMapsScraper:
    """Scrapes Google Maps search results using a headless browser."""

    def __init__(self):
        self.browser: Browser | None = None
        self.context = None

    async def start(self):
        pw = await async_playwright().start()
        self.browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )
        self.context = await self.browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )

    async def stop(self):
        if self.browser:
            await self.browser.close()

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
        """
        if existing_gmb_links is None:
            existing_gmb_links = set()

        query = f"{niche} in {area}"
        search_url = f"https://www.google.com/maps/search/{quote_plus(query)}"

        page = await self.context.new_page()
        businesses = []

        try:
            await page.goto(search_url, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(2)

            # Try to dismiss consent dialog if present
            try:
                accept_btn = page.locator('button:has-text("Accept all")')
                if await accept_btn.count() > 0:
                    await accept_btn.first.click()
                    await asyncio.sleep(1)
            except Exception:
                pass

            # Scroll through results to load more
            results_panel = page.locator('div[role="feed"]')
            if await results_panel.count() == 0:
                results_panel = page.locator('div[role="main"]')

            prev_count = 0
            scroll_attempts = 0
            max_scroll_attempts = 30

            while scroll_attempts < max_scroll_attempts:
                # Get all listing links
                listings = page.locator('a[href*="/maps/place/"]')
                current_count = await listings.count()

                if current_count >= max_results:
                    break

                if current_count == prev_count:
                    scroll_attempts += 1
                    if scroll_attempts >= 5:
                        # Check for end of list
                        end_marker = page.locator('span:has-text("You\'ve reached the end")')
                        if await end_marker.count() > 0:
                            break
                else:
                    scroll_attempts = 0

                prev_count = current_count

                # Scroll within the results panel
                try:
                    await results_panel.evaluate(
                        "el => el.scrollBy(0, 800)"
                    )
                except Exception:
                    await page.mouse.wheel(0, 800)

                await asyncio.sleep(1)

            # Now extract each listing
            listings = page.locator('a[href*="/maps/place/"]')
            count = min(await listings.count(), max_results)

            if progress_callback:
                await progress_callback({
                    "stage": "found_listings",
                    "total": count,
                    "scraped": 0,
                    "skipped": 0,
                })

            skipped = 0
            for i in range(count):
                try:
                    listing = listings.nth(i)
                    href = await listing.get_attribute("href")

                    if not href:
                        continue

                    # Duplicate detection
                    if href in existing_gmb_links:
                        skipped += 1
                        if progress_callback:
                            await progress_callback({
                                "stage": "scraping",
                                "current": i + 1,
                                "total": count,
                                "skipped": skipped,
                                "scraped": len(businesses),
                            })
                        continue

                    # Click on listing to open details
                    try:
                        await listing.click(timeout=5000)
                    except Exception:
                        continue
                    await asyncio.sleep(2)

                    biz = await self._extract_business_details(page, href)
                    if biz:
                        # Apply module filter
                        if module == "no_website" and biz.get("website"):
                            skipped += 1
                        else:
                            businesses.append(biz)

                    if progress_callback:
                        await progress_callback({
                            "stage": "scraping",
                            "current": i + 1,
                            "total": count,
                            "skipped": skipped,
                            "scraped": len(businesses),
                        })

                except Exception as e:
                    logger.warning(f"Error extracting listing {i}: {e}")
                    continue

        except Exception as e:
            logger.error(f"Scraping error: {e}")
        finally:
            await page.close()

        return businesses

    async def _extract_business_details(self, page: Page, gmb_link: str) -> dict | None:
        """Extract business details from the currently opened listing panel."""
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

            # Business name
            try:
                name_el = page.locator('h1').first
                if await name_el.count() > 0:
                    details["business_name"] = (await name_el.inner_text()).strip()
            except Exception:
                pass

            if not details["business_name"]:
                return None

            # Category
            try:
                cat_el = page.locator('button[jsaction*="category"]').first
                if await cat_el.count() > 0:
                    details["category"] = (await cat_el.inner_text()).strip()
            except Exception:
                pass

            # Rating
            try:
                rating_el = page.locator('div.F7nice span[aria-hidden="true"]').first
                if await rating_el.count() > 0:
                    rating_text = await rating_el.inner_text()
                    details["rating"] = float(rating_text.strip())
            except Exception:
                pass

            # Review count
            try:
                review_el = page.locator('div.F7nice span[aria-label*="review"]').first
                if await review_el.count() > 0:
                    review_text = await review_el.get_attribute("aria-label")
                    if review_text:
                        nums = re.findall(r'[\d,]+', review_text)
                        if nums:
                            details["review_count"] = int(nums[0].replace(",", ""))
            except Exception:
                pass

            # Address, Phone, Website from info section
            try:
                info_buttons = page.locator(
                    'button[data-item-id], a[data-item-id]'
                )
                info_count = await info_buttons.count()
                for j in range(info_count):
                    try:
                        btn = info_buttons.nth(j)
                        data_id = await btn.get_attribute("data-item-id") or ""
                        aria = await btn.get_attribute("aria-label") or ""
                        text = (await btn.inner_text()).strip()

                        if "address" in data_id or "Address" in aria:
                            details["address"] = aria.replace("Address: ", "").strip() or text
                        elif "phone" in data_id or "Phone" in aria:
                            details["phone"] = aria.replace("Phone: ", "").strip() or text
                        elif "authority" in data_id or "website" in data_id.lower():
                            website = aria.replace("Website: ", "").strip() or text
                            if website and not website.startswith("http"):
                                website = "https://" + website
                            details["website"] = website
                            details["has_website"] = True
                    except Exception:
                        continue
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
            await page.goto(gmb_link, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(3)

            # Dismiss consent if needed
            try:
                accept_btn = page.locator('button:has-text("Accept all")')
                if await accept_btn.count() > 0:
                    await accept_btn.first.click()
                    await asyncio.sleep(1)
            except Exception:
                pass

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
                timeout=15, follow_redirects=True,
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
                    result["recommendations"].append("Add a descriptive title tag (50-60 chars)")

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
                    result["recommendations"].append("Add meta description (150-160 chars)")

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
                    alt_ratio = imgs_with_alt / len(images) if images else 0
                    seo_points += int(alt_ratio * 10)
                    if alt_ratio < 0.5:
                        result["issues"].append(f"Only {int(alt_ratio*100)}% images have alt tags")
                        result["recommendations"].append("Add alt text to all images")
                else:
                    seo_points += 5

                # 6. Mobile viewport (10 pts)
                viewport = soup.find("meta", attrs={"name": "viewport"})
                if viewport:
                    seo_points += 10
                else:
                    result["issues"].append("Missing viewport meta tag")
                    result["recommendations"].append("Add viewport meta tag for mobile")
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
                    result["issues"].append("No structured data / schema markup")
                    result["recommendations"].append("Add LocalBusiness schema markup")

                # 9. Page speed indicators (10 pts)
                # Check for large inline styles, excessive scripts
                scripts = soup.find_all("script")
                stylesheets = soup.find_all("link", rel="stylesheet")
                if len(scripts) < 15 and len(stylesheets) < 10:
                    seo_points += 10
                elif len(scripts) < 25:
                    seo_points += 5
                    result["issues"].append("Too many scripts loaded")
                else:
                    result["issues"].append("Excessive scripts may slow page load")
                    result["recommendations"].append("Optimize and reduce JS bundles")

                # 10. Internal links (5 pts)
                links = soup.find_all("a", href=True)
                domain = urlparse(website_url).netloc
                internal = [l for l in links if domain in (urlparse(l["href"]).netloc or domain)]
                if len(internal) >= 3:
                    seo_points += 5
                else:
                    result["issues"].append("Very few internal links")

                # 11. Social links (5 pts)
                social_domains = ["facebook.com", "twitter.com", "instagram.com",
                                  "linkedin.com", "youtube.com", "tiktok.com", "x.com"]
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
                    result["recommendations"].append("Add links to social media profiles")

                # 12. Contact info (5 pts)
                page_text = soup.get_text()
                has_phone = bool(re.search(r'[\(\+]?\d[\d\-\(\) ]{7,}\d', page_text))
                has_email_on_page = bool(re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', page_text))
                if has_phone or has_email_on_page:
                    seo_points += 5
                else:
                    result["issues"].append("No visible contact info on website")

                # 13. Detect old/outdated website indicators (5 pts)
                # Flash, table layouts, inline styles heavily used
                flash_embeds = soup.find_all("embed", type=lambda x: x and "flash" in x.lower())
                table_layout = len(soup.find_all("table")) > 5
                if flash_embeds or table_layout:
                    result["has_old_website"] = True
                    result["issues"].append("Website appears to use outdated technologies")
                    result["recommendations"].append("Modernize website with current standards")
                else:
                    seo_points += 5

                # Check copyright year
                copyright_match = re.search(r'©\s*(\d{4})', page_text)
                if copyright_match:
                    year = int(copyright_match.group(1))
                    if year < 2022:
                        result["has_old_website"] = True
                        result["issues"].append(f"Copyright year is {year}, website may be outdated")

                result["seo_score"] = min(seo_points, max_points)
                result["is_seo_optimized"] = seo_points >= 70

                # Extract email from website
                emails = re.findall(
                    r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
                    page_text
                )
                filtered = [e for e in emails if not e.endswith(('.png', '.jpg', '.gif', '.svg'))]
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

        # Business name (10 pts)
        if biz.get("business_name"):
            score += 10
        else:
            issues.append("Missing business name")

        # Phone (15 pts)
        if biz.get("phone"):
            score += 15
        else:
            issues.append("No phone number on GMB")
            recommendations.append("Add phone number to GMB profile")

        # Website (15 pts)
        if biz.get("website"):
            score += 15
        else:
            issues.append("No website linked on GMB")
            recommendations.append("Add website to GMB profile")

        # Address (10 pts)
        if biz.get("address"):
            score += 10
        else:
            issues.append("No address on GMB")

        # Category (10 pts)
        if biz.get("category"):
            score += 10
        else:
            issues.append("No business category set")
            recommendations.append("Set appropriate business category")

        # Rating (20 pts)
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

        # Review count (20 pts)
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
    async def find_owner(business_name: str, website: str, page: Page) -> dict:
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
            domain = urlparse(website).netloc or website.replace("https://", "").replace("http://", "").split("/")[0]

        if domain:
            search_queries.append(f'"CEO" OR "owner" OR "founder" site:{domain}')
            search_queries.append(f'{domain} CEO OR owner OR founder linkedin.com')
        if business_name:
            search_queries.append(f'"{business_name}" CEO OR owner OR founder')
            search_queries.append(f'"{business_name}" site:linkedin.com')

        for query in search_queries[:2]:
            try:
                search_url = f"https://www.google.com/search?q={quote_plus(query)}"
                await page.goto(search_url, wait_until="networkidle", timeout=15000)
                await asyncio.sleep(2)

                content = await page.content()
                soup = BeautifulSoup(content, "html.parser")

                # Look for LinkedIn profiles
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if "linkedin.com/in/" in href:
                        linkedin_url = href
                        if "/url?q=" in linkedin_url:
                            linkedin_url = linkedin_url.split("/url?q=")[1].split("&")[0]
                        owner_info["owner_linkedin"] = linkedin_url

                        # Try to extract name from link text
                        text = a.get_text(strip=True)
                        if text and "-" in text:
                            name = text.split("-")[0].strip()
                            if len(name.split()) <= 4:
                                owner_info["owner_name"] = name
                        break

                # Look for social profiles
                socials = {}
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    for platform in ["facebook.com", "twitter.com", "x.com", "instagram.com"]:
                        if platform in href and platform not in socials:
                            clean_url = href
                            if "/url?q=" in clean_url:
                                clean_url = clean_url.split("/url?q=")[1].split("&")[0]
                            socials[platform] = clean_url

                if socials:
                    owner_info["owner_social"] = json.dumps(socials)

                if owner_info["owner_name"] or owner_info["owner_linkedin"]:
                    break

            except Exception as e:
                logger.warning(f"Owner search error: {e}")
                continue

        return owner_info
