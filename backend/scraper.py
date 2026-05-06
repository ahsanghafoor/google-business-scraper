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
    """Analyzes a business website for SEO, quality, and contact information."""

    # Email patterns to exclude (not real contact emails)
    _BAD_EMAIL_PATTERNS = {
        "noreply", "no-reply", "donotreply", "mailer-daemon", "postmaster",
        "webmaster@", "example.com", "sentry.", "wixpress.com",
        "wordpress.com", "squarespace.com", "godaddy.com",
    }
    _BAD_EMAIL_EXTENSIONS = ('.png', '.jpg', '.gif', '.svg', '.css', '.js', '.webp')

    @staticmethod
    def _is_valid_email(email: str) -> bool:
        email_lower = email.lower()
        if any(p in email_lower for p in WebsiteAnalyzer._BAD_EMAIL_PATTERNS):
            return False
        if any(email_lower.endswith(ext) for ext in WebsiteAnalyzer._BAD_EMAIL_EXTENSIONS):
            return False
        if len(email) > 100 or len(email) < 5:
            return False
        return True

    @staticmethod
    def _prioritize_emails(emails: list[str]) -> str:
        """Pick the best contact email from a list."""
        if not emails:
            return ""
        priority_prefixes = ["info", "contact", "hello", "sales", "office", "admin", "support"]
        for prefix in priority_prefixes:
            for e in emails:
                if e.lower().startswith(prefix):
                    return e
        return emails[0]

    @staticmethod
    async def _fetch_page(client: httpx.AsyncClient, url: str) -> tuple[str, BeautifulSoup | None]:
        """Fetch a page and return (text, soup). Returns ('', None) on failure."""
        try:
            resp = await client.get(url, timeout=15)
            if resp.status_code < 400:
                html = resp.text
                return html, BeautifulSoup(html, "html.parser")
        except Exception:
            pass
        return "", None

    @staticmethod
    async def _crawl_subpages(client: httpx.AsyncClient, base_url: str, homepage_soup: BeautifulSoup) -> list[tuple[str, BeautifulSoup]]:
        """Find and fetch contact/about/team pages from the homepage."""
        results = []
        domain = urlparse(base_url).netloc
        contact_patterns = re.compile(
            r'(contact|about|team|staff|our-team|about-us|contact-us|meet)',
            re.IGNORECASE,
        )

        seen = {base_url.rstrip("/")}
        candidates = []
        for a in homepage_soup.find_all("a", href=True):
            href = a["href"].strip()
            text = a.get_text(strip=True).lower()

            if contact_patterns.search(href) or contact_patterns.search(text):
                if href.startswith("/"):
                    full = f"{urlparse(base_url).scheme}://{domain}{href}"
                elif href.startswith("http"):
                    if domain not in urlparse(href).netloc:
                        continue
                    full = href
                else:
                    full = f"{base_url.rstrip('/')}/{href}"

                full = full.split("#")[0].split("?")[0].rstrip("/")
                if full not in seen:
                    seen.add(full)
                    candidates.append(full)

        # Also try common paths directly
        for path in ["/contact", "/about", "/about-us", "/contact-us", "/team", "/our-team"]:
            full = f"{urlparse(base_url).scheme}://{domain}{path}"
            if full not in seen:
                seen.add(full)
                candidates.append(full)

        for url in candidates[:6]:
            _, soup = await WebsiteAnalyzer._fetch_page(client, url)
            if soup:
                results.append((url, soup))

        return results

    @staticmethod
    def _extract_emails_from_soup(soup: BeautifulSoup) -> list[str]:
        """Extract emails from page text and mailto: links."""
        emails = set()

        # From mailto: links
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("mailto:"):
                email = href.replace("mailto:", "").split("?")[0].strip()
                if WebsiteAnalyzer._is_valid_email(email):
                    emails.add(email)

        # From page text
        page_text = soup.get_text()
        found = re.findall(
            r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
            page_text,
        )
        for e in found:
            if WebsiteAnalyzer._is_valid_email(e):
                emails.add(e)

        return list(emails)

    @staticmethod
    def _detect_website_quality(soup: BeautifulSoup, html: str, url: str) -> dict:
        """Deep analysis of website quality, design, and UX issues."""
        quality = {
            "design_age": "modern",
            "has_contact_form": False,
            "contact_form_issues": [],
            "ui_ux_issues": [],
            "mobile_issues": [],
            "performance_issues": [],
            "tech_stack": [],
            "outdated_indicators": [],
        }

        page_text = soup.get_text()
        html_lower = html.lower()

        # ── Tech stack detection ────────────────────────────
        if "wp-content" in html or "wordpress" in html_lower:
            quality["tech_stack"].append("WordPress")
        if "wix.com" in html_lower or "wixsite" in html_lower:
            quality["tech_stack"].append("Wix")
        if "squarespace" in html_lower:
            quality["tech_stack"].append("Squarespace")
        if "shopify" in html_lower:
            quality["tech_stack"].append("Shopify")
        if "joomla" in html_lower:
            quality["tech_stack"].append("Joomla")
        if "drupal" in html_lower:
            quality["tech_stack"].append("Drupal")
        if "weebly" in html_lower:
            quality["tech_stack"].append("Weebly")
        if "godaddy" in html_lower:
            quality["tech_stack"].append("GoDaddy Website Builder")

        # React / Next / Vue / Angular
        if "react" in html_lower or "__next" in html_lower:
            quality["tech_stack"].append("React/Next.js")
        if "vue" in html_lower and "vue.js" in html_lower:
            quality["tech_stack"].append("Vue.js")
        if "ng-" in html or "angular" in html_lower:
            quality["tech_stack"].append("Angular")

        # Bootstrap version
        bootstrap_match = re.search(r'bootstrap[/.](\d+)', html_lower)
        if bootstrap_match:
            bs_ver = int(bootstrap_match.group(1))
            quality["tech_stack"].append(f"Bootstrap {bs_ver}")
            if bs_ver < 4:
                quality["outdated_indicators"].append(
                    f"Using Bootstrap {bs_ver} (current is 5)"
                )

        # jQuery version
        jquery_match = re.search(r'jquery[.-](\d+)\.(\d+)', html_lower)
        if jquery_match:
            jq_major = int(jquery_match.group(1))
            quality["tech_stack"].append(f"jQuery {jq_major}.x")
            if jq_major < 3:
                quality["outdated_indicators"].append(
                    f"Using jQuery {jq_major}.x (outdated)"
                )

        # ── Outdated design detection ───────────────────────
        # Flash
        flash_embeds = soup.find_all("embed", type=lambda x: x and "flash" in x.lower())
        flash_objects = soup.find_all("object", type=lambda x: x and "flash" in x.lower())
        if flash_embeds or flash_objects:
            quality["outdated_indicators"].append("Uses Flash content (obsolete technology)")
            quality["design_age"] = "outdated"

        # Table-based layout
        tables = soup.find_all("table")
        tables_with_layout = [
            t for t in tables
            if t.find("td") and not t.find("th") and len(t.find_all("td")) > 4
        ]
        if len(tables_with_layout) > 2:
            quality["outdated_indicators"].append("Table-based layout detected (outdated design)")
            quality["design_age"] = "outdated"

        # Inline styles (excessive = poor practice)
        inline_count = len(soup.find_all(style=True))
        if inline_count > 30:
            quality["ui_ux_issues"].append(
                f"Excessive inline styles ({inline_count}+) — indicates poor CSS architecture"
            )

        # Frames / iframes for layout (not embeds)
        frames = soup.find_all("frame") + soup.find_all("frameset")
        if frames:
            quality["outdated_indicators"].append("Uses frames (deprecated HTML)")
            quality["design_age"] = "outdated"

        # Marquee tags
        if soup.find("marquee") or soup.find("blink"):
            quality["outdated_indicators"].append("Uses <marquee> or <blink> tags (1990s web design)")
            quality["design_age"] = "outdated"

        # Copyright year check
        copyright_matches = re.findall(r'©\s*(\d{4})', page_text)
        if copyright_matches:
            latest_year = max(int(y) for y in copyright_matches)
            if latest_year < 2022:
                quality["outdated_indicators"].append(
                    f"Copyright year is {latest_year} — website may be unmaintained"
                )
                quality["design_age"] = "outdated"
            elif latest_year < 2024:
                quality["outdated_indicators"].append(
                    f"Copyright year is {latest_year} — may need updating"
                )

        # ── Mobile responsiveness ───────────────────────────
        viewport = soup.find("meta", attrs={"name": "viewport"})
        if not viewport:
            quality["mobile_issues"].append("Missing viewport meta tag — site likely not mobile-friendly")

        # Check for responsive CSS indicators
        has_media_queries = "@media" in html
        has_responsive_classes = any(
            cls in html for cls in ["col-md-", "col-lg-", "col-sm-", "responsive", "container-fluid"]
        )
        if not has_media_queries and not has_responsive_classes and not viewport:
            quality["mobile_issues"].append("No responsive design indicators found")
            if quality["design_age"] != "outdated":
                quality["design_age"] = "outdated"

        # Fixed-width layout
        fixed_width = re.search(r'width\s*:\s*(\d{3,4})px', html)
        if fixed_width and int(fixed_width.group(1)) > 900:
            quality["mobile_issues"].append(
                f"Fixed-width layout ({fixed_width.group(1)}px) — not mobile-friendly"
            )

        # ── Contact form detection ──────────────────────────
        forms = soup.find_all("form")
        contact_form = None
        for form in forms:
            form_text = form.get_text(strip=True).lower()
            form_html = str(form).lower()
            has_contact_indicators = any(
                w in form_text or w in form_html
                for w in ["message", "contact", "email", "name", "phone", "enquiry", "inquiry", "send", "submit"]
            )
            if has_contact_indicators:
                contact_form = form
                break

        if contact_form:
            quality["has_contact_form"] = True
            # Check form action
            action = contact_form.get("action", "")
            if not action or action == "#" or action == "":
                quality["contact_form_issues"].append(
                    "Contact form has no action URL — may not be functional"
                )
            # Check for email/name fields
            inputs = contact_form.find_all(["input", "textarea", "select"])
            field_types = [
                (inp.get("type", "") + " " + (inp.get("name", "") or "") + " " + (inp.get("placeholder", "") or "")).lower()
                for inp in inputs
            ]
            has_email_field = any("email" in f for f in field_types)
            has_name_field = any("name" in f for f in field_types)
            has_message = any("message" in f or "textarea" in inp.name for inp, f in zip(inputs, field_types))
            if not has_email_field:
                quality["contact_form_issues"].append("Contact form missing email field")
            if not has_name_field:
                quality["contact_form_issues"].append("Contact form missing name field")
            if not has_message:
                quality["contact_form_issues"].append("Contact form missing message/textarea field")
        else:
            quality["contact_form_issues"].append(
                "No contact form found on the page"
            )

        # ── UI/UX Issues ────────────────────────────────────
        # Missing navigation
        nav = soup.find("nav") or soup.find(role="navigation")
        if not nav:
            header = soup.find("header")
            nav_links = header.find_all("a") if header else []
            if len(nav_links) < 3:
                quality["ui_ux_issues"].append("Missing or minimal navigation menu")

        # Missing favicon
        favicon = soup.find("link", rel=lambda x: x and "icon" in " ".join(x) if isinstance(x, list) else x and "icon" in x)
        if not favicon:
            quality["ui_ux_issues"].append("Missing favicon — looks unprofessional in browser tab")

        # No heading structure
        headings = soup.find_all(["h1", "h2", "h3"])
        if len(headings) < 2:
            quality["ui_ux_issues"].append("Poor heading structure — hard to scan content")

        # Very long page with no sections
        text_length = len(page_text)
        sections = soup.find_all(["section", "article", "aside"])
        if text_length > 5000 and len(sections) < 2:
            quality["ui_ux_issues"].append("Long page with no clear content sections")

        # Missing footer
        footer = soup.find("footer")
        if not footer:
            quality["ui_ux_issues"].append("Missing footer section")

        # Low contrast / accessibility
        images = soup.find_all("img")
        imgs_without_alt = [img for img in images if not img.get("alt")]
        if images and len(imgs_without_alt) > len(images) * 0.5:
            quality["ui_ux_issues"].append(
                f"{len(imgs_without_alt)}/{len(images)} images missing alt text — poor accessibility"
            )

        # ── Performance indicators ──────────────────────────
        scripts = soup.find_all("script")
        stylesheets = soup.find_all("link", rel="stylesheet")

        if len(scripts) > 20:
            quality["performance_issues"].append(
                f"Excessive JavaScript files ({len(scripts)}) — may cause slow loading"
            )
        if len(stylesheets) > 10:
            quality["performance_issues"].append(
                f"Too many CSS files ({len(stylesheets)}) — consider bundling"
            )

        # Large images without lazy loading
        large_imgs = [
            img for img in images
            if not img.get("loading") and not img.get("data-src")
        ]
        if len(large_imgs) > 5:
            quality["performance_issues"].append(
                f"{len(large_imgs)} images without lazy loading — affects page speed"
            )

        # Render-blocking resources
        blocking_css = [
            s for s in stylesheets
            if not s.get("media") or s.get("media") == "all"
        ]
        if len(blocking_css) > 5:
            quality["performance_issues"].append(
                "Multiple render-blocking CSS files detected"
            )

        # Determine overall design age
        if quality["outdated_indicators"]:
            quality["design_age"] = "outdated"
        elif quality["mobile_issues"] or len(quality["ui_ux_issues"]) > 3:
            quality["design_age"] = "needs_improvement"

        return quality

    @staticmethod
    async def analyze(website_url: str) -> dict:
        """Perform comprehensive SEO, quality, and contact analysis on a website."""
        result = {
            "seo_score": 0,
            "gmb_score": 0,
            "has_old_website": False,
            "is_seo_optimized": False,
            "issues": [],
            "recommendations": [],
            "emails": [],
            "email": "",
            "website_quality": {},
            "phones_from_website": [],
        }

        if not website_url:
            return result

        try:
            async with httpx.AsyncClient(
                timeout=20, follow_redirects=True,
                verify=False,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
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
                    alt_ratio = imgs_with_alt / len(images)
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
                    result["issues"].append("Missing viewport meta tag — not mobile-friendly")
                    result["recommendations"].append("Add viewport meta tag for mobile responsiveness")
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
                social_domains = ["facebook.com", "twitter.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com", "x.com"]
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
                    result["recommendations"].append("Add phone number and email to the website")

                # 13. Detect old/outdated website indicators (5 pts)
                flash_embeds = soup.find_all("embed", type=lambda x: x and "flash" in x.lower())
                table_layout = len(soup.find_all("table")) > 5
                if flash_embeds or table_layout:
                    result["has_old_website"] = True
                    result["issues"].append("Website appears to use outdated technologies")
                    result["recommendations"].append("Modernize website with current standards")
                else:
                    seo_points += 5

                # Copyright year
                copyright_match = re.search(r'©\s*(\d{4})', page_text)
                if copyright_match:
                    year = int(copyright_match.group(1))
                    if year < 2022:
                        result["has_old_website"] = True
                        result["issues"].append(f"Copyright year is {year}, website may be outdated")

                result["seo_score"] = min(seo_points, max_points)
                result["is_seo_optimized"] = seo_points >= 70

                # ── Multi-page email extraction ─────────────────
                all_emails = set()

                # Extract from homepage
                homepage_emails = WebsiteAnalyzer._extract_emails_from_soup(soup)
                all_emails.update(homepage_emails)

                # Extract from sub-pages (contact, about, team)
                try:
                    subpages = await WebsiteAnalyzer._crawl_subpages(client, website_url, soup)
                    for sub_url, sub_soup in subpages:
                        sub_emails = WebsiteAnalyzer._extract_emails_from_soup(sub_soup)
                        all_emails.update(sub_emails)
                except Exception:
                    pass

                result["emails"] = list(all_emails)
                result["email"] = WebsiteAnalyzer._prioritize_emails(list(all_emails))

                # ── Extract phone numbers from website ──────────
                all_text = page_text
                try:
                    for _, sub_soup in subpages:
                        all_text += " " + sub_soup.get_text()
                except Exception:
                    pass

                phones = re.findall(r'[\(\+]?\d[\d\-\(\) ]{7,}\d', all_text)
                unique_phones = list(dict.fromkeys(p.strip() for p in phones if len(p.strip()) >= 10))
                result["phones_from_website"] = unique_phones[:5]

                # ── Website quality analysis ────────────────────
                result["website_quality"] = WebsiteAnalyzer._detect_website_quality(soup, html, website_url)
                if result["website_quality"]["design_age"] == "outdated":
                    result["has_old_website"] = True

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
    """Finds business owner information using multiple strategies."""

    # Title patterns that indicate an owner/principal
    _OWNER_TITLES = re.compile(
        r'\b(ceo|owner|founder|co-founder|president|principal|managing\s+director'
        r'|proprietor|partner|director|chief\s+executive)\b',
        re.IGNORECASE,
    )

    @staticmethod
    async def _scrape_website_for_owner(website: str) -> dict:
        """Scrape the business website's about/team pages for owner info."""
        info = {"owner_name": "", "owner_linkedin": "", "owner_social": "", "owner_title": ""}

        if not website:
            return info

        domain = urlparse(website).netloc or website.replace("https://", "").replace("http://", "").split("/")[0]

        try:
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=True, verify=False,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"}
            ) as client:
                # Fetch homepage
                resp = await client.get(website)
                homepage_soup = BeautifulSoup(resp.text, "html.parser")

                # Collect pages to check
                pages_to_check = [(website, homepage_soup)]

                # Find about/team links
                about_patterns = re.compile(r'(about|team|staff|our-team|about-us|leadership|people|who-we-are)', re.IGNORECASE)
                seen = {website.rstrip("/")}

                for a in homepage_soup.find_all("a", href=True):
                    href = a["href"].strip()
                    text = a.get_text(strip=True).lower()

                    if about_patterns.search(href) or about_patterns.search(text):
                        if href.startswith("/"):
                            full = f"{urlparse(website).scheme}://{domain}{href}"
                        elif href.startswith("http"):
                            if domain not in urlparse(href).netloc:
                                continue
                            full = href
                        else:
                            full = f"{website.rstrip('/')}/{href}"

                        full = full.split("#")[0].split("?")[0].rstrip("/")
                        if full not in seen:
                            seen.add(full)
                            try:
                                r = await client.get(full, timeout=10)
                                if r.status_code < 400:
                                    pages_to_check.append((full, BeautifulSoup(r.text, "html.parser")))
                            except Exception:
                                pass
                    if len(pages_to_check) >= 4:
                        break

                # Also try common paths
                for path in ["/about", "/about-us", "/team", "/our-team"]:
                    full = f"{urlparse(website).scheme}://{domain}{path}"
                    if full not in seen:
                        seen.add(full)
                        try:
                            r = await client.get(full, timeout=10)
                            if r.status_code < 400:
                                pages_to_check.append((full, BeautifulSoup(r.text, "html.parser")))
                        except Exception:
                            pass
                    if len(pages_to_check) >= 5:
                        break

                # Search each page for owner info
                for page_url, soup in pages_to_check:
                    page_text = soup.get_text()

                    # Look for owner title patterns near names
                    for tag in soup.find_all(["p", "div", "span", "h2", "h3", "h4", "li", "td", "strong"]):
                        text = tag.get_text(strip=True)
                        if len(text) < 5 or len(text) > 300:
                            continue

                        title_match = OwnerFinder._OWNER_TITLES.search(text)
                        if title_match:
                            # Try to extract the name near the title
                            # Pattern: "Name - Title" or "Name, Title" or "Title: Name"
                            for pattern in [
                                r'^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[-–,|]\s*' + title_match.group(0),
                                title_match.group(0) + r'\s*[-–,|:]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})',
                            ]:
                                name_match = re.search(pattern, text, re.IGNORECASE)
                                if name_match:
                                    name = name_match.group(1).strip()
                                    if 2 <= len(name.split()) <= 4 and len(name) < 50:
                                        info["owner_name"] = name
                                        info["owner_title"] = title_match.group(0).strip()
                                        break

                            # If no name found yet, check parent/sibling elements
                            if not info["owner_name"]:
                                parent = tag.parent
                                if parent:
                                    siblings = parent.find_all(["h2", "h3", "h4", "strong", "b", "span"])
                                    for sib in siblings:
                                        sib_text = sib.get_text(strip=True)
                                        if sib_text != text and re.match(r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$', sib_text):
                                            if len(sib_text.split()) <= 4:
                                                info["owner_name"] = sib_text
                                                info["owner_title"] = title_match.group(0).strip()
                                                break

                    # Look for LinkedIn links
                    for a in soup.find_all("a", href=True):
                        href = a["href"]
                        if "linkedin.com/in/" in href:
                            info["owner_linkedin"] = href.split("?")[0]
                            if not info["owner_name"]:
                                link_text = a.get_text(strip=True)
                                if link_text and re.match(r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$', link_text):
                                    info["owner_name"] = link_text
                            break

                    # Look for social media links
                    socials = {}
                    for a in soup.find_all("a", href=True):
                        href = a["href"]
                        for platform in ["facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com"]:
                            if platform in href and platform not in socials:
                                socials[platform] = href.split("?")[0]
                    if socials:
                        info["owner_social"] = json.dumps(socials)

                    if info["owner_name"]:
                        break

        except Exception as e:
            logger.debug(f"Website owner scrape error: {e}")

        return info

    @staticmethod
    async def _google_search_owner(business_name: str, website: str, page: Page) -> dict:
        """Search Google for owner/CEO info as a fallback."""
        info = {"owner_name": "", "owner_linkedin": "", "owner_social": "", "owner_title": ""}

        domain = ""
        if website:
            domain = urlparse(website).netloc or website.replace("https://", "").replace("http://", "").split("/")[0]

        search_queries = []
        if business_name:
            search_queries.append(f'"{business_name}" owner OR CEO OR founder')
            search_queries.append(f'"{business_name}" site:linkedin.com')
        if domain:
            search_queries.append(f'{domain} owner OR CEO OR founder linkedin.com')

        for query in search_queries[:2]:
            try:
                search_url = f"https://www.google.com/search?q={quote_plus(query)}"
                await page.goto(search_url, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(2)

                content = await page.content()
                soup = BeautifulSoup(content, "html.parser")

                # Extract from Google's knowledge panel / featured snippet
                for div in soup.find_all(["div", "span"]):
                    text = div.get_text(strip=True)
                    if OwnerFinder._OWNER_TITLES.search(text) and len(text) < 200:
                        for pattern in [
                            r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[-–,|]\s*(?:CEO|Owner|Founder|President)',
                            r'(?:CEO|Owner|Founder|President)\s*[-–,|:]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})',
                        ]:
                            m = re.search(pattern, text, re.IGNORECASE)
                            if m:
                                name = m.group(1).strip()
                                if 2 <= len(name.split()) <= 4:
                                    info["owner_name"] = name
                                    break
                    if info["owner_name"]:
                        break

                # Find LinkedIn profile
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if "linkedin.com/in/" in href:
                        linkedin_url = href
                        if "/url?q=" in linkedin_url:
                            linkedin_url = linkedin_url.split("/url?q=")[1].split("&")[0]
                        info["owner_linkedin"] = linkedin_url.split("?")[0]

                        if not info["owner_name"]:
                            text = a.get_text(strip=True)
                            if text and "-" in text:
                                name = text.split("-")[0].strip()
                                if 2 <= len(name.split()) <= 4:
                                    info["owner_name"] = name
                        break

                # Social media links
                socials = {}
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    for platform in ["facebook.com", "twitter.com", "x.com", "instagram.com"]:
                        if platform in href and platform not in socials:
                            clean_url = href
                            if "/url?q=" in clean_url:
                                clean_url = clean_url.split("/url?q=")[1].split("&")[0]
                            socials[platform] = clean_url

                if socials and not info.get("owner_social"):
                    info["owner_social"] = json.dumps(socials)

                if info["owner_name"] or info["owner_linkedin"]:
                    break

            except Exception as e:
                logger.warning(f"Google owner search error: {e}")
                continue

        return info

    @staticmethod
    async def find_owner(
        business_name: str, website: str, page: Page
    ) -> dict:
        """Find owner info using multiple strategies:
        1. Scrape the business website (about/team pages)
        2. Google search as fallback
        """
        owner_info = {
            "owner_name": "",
            "owner_linkedin": "",
            "owner_social": "",
            "owner_title": "",
            "phone": "",
        }

        if not website and not business_name:
            return owner_info

        # Strategy 1: Scrape the business website directly (fast, no Google needed)
        if website:
            try:
                website_info = await OwnerFinder._scrape_website_for_owner(website)
                if website_info.get("owner_name"):
                    owner_info.update({k: v for k, v in website_info.items() if v})
            except Exception as e:
                logger.debug(f"Website owner scrape failed: {e}")

        # Strategy 2: Google search (fallback if website didn't find owner)
        if not owner_info["owner_name"]:
            try:
                google_info = await OwnerFinder._google_search_owner(
                    business_name, website, page
                )
                owner_info.update({k: v for k, v in google_info.items() if v})
            except Exception as e:
                logger.debug(f"Google owner search failed: {e}")

        return owner_info
