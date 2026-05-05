# LeadScraper Pro — Google Business Scraper & Lead Management

A free, browser-based Google Business scraper and lead management system. No API keys required — uses Playwright for browser automation to scrape Google Maps directly.

## Features

### Scraper Modules
1. **No-Website Scraper** — Find businesses without websites for website development pitches
2. **All Businesses Scraper** — Full analysis including SEO audit, GMB optimization scoring, and lead scoring

### Data Collected
- Business name, phone, email, address
- Website URL and analysis
- Google Maps (GMB) link
- Rating and review count
- Business category
- Owner/CEO details (LinkedIn, social profiles)

### SEO & GMB Audit
- 13-point SEO analysis (title tags, meta descriptions, H1, schema markup, mobile viewport, HTTPS, etc.)
- GMB optimization scoring (completeness, ratings, reviews)
- Outdated website detection
- Automated pitch recommendations (Website, SEO, AI Chatbot services)

### Lead Management
- Lead scoring: Hot / Warm / Cold based on optimization gaps
- Status tracking: Not Contacted → Emailed / Called / Messaged → Follow Up → Converted / Lost
- Activity timeline for each lead
- Notes and contact info editing
- CSV export with filters

### Smart Features
- **Duplicate detection**: Skips already-scraped businesses by name and GMB link
- **Manual GMB input**: Paste any Google Maps link to add a lead
- **Real-time progress**: Live scraping progress with stage indicators
- **Owner discovery**: Searches Google for CEO/owner LinkedIn and social profiles

## Quick Start

### Prerequisites
- Python 3.10+
- pip

### Installation

```bash
# Clone the repo
git clone <repo-url>
cd google-business-scraper

# Install dependencies
pip install -e .

# Install Playwright browsers
playwright install chromium

# Run the app
python run.py
```

The app will be available at **http://localhost:8000**

## Usage

### 1. Scrape Businesses
- Go to the **Scraper** page
- Enter a business niche (e.g., "Electrician") and area (e.g., "Sugar Land, TX, US")
- Choose the scraping module:
  - **All Businesses**: Scrapes all results with full SEO/GMB analysis
  - **No Website Only**: Only captures businesses without websites
- Optionally enable owner discovery
- Click **Start Scraping**

### 2. Manual GMB Link
- Paste a Google Maps business link
- The system automatically fetches all details and runs analysis

### 3. Manage Leads
- View all leads with filters (niche, area, type, status, website)
- Click a lead to see full details, audit report, and activity timeline
- Update status as you reach out (Email, Call, Message)
- Add notes and activities to track interactions
- Export filtered leads as CSV

### 4. Dashboard
- Overview of all leads with key metrics
- Hot/Warm/Cold lead counts
- Contact and conversion tracking

## Tech Stack
- **Backend**: Python, FastAPI, SQLAlchemy, SQLite
- **Scraper**: Playwright (headless Chromium)
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Analysis**: BeautifulSoup, httpx

## Project Structure
```
google-business-scraper/
├── backend/
│   ├── __init__.py
│   ├── database.py      # SQLAlchemy models & DB setup
│   ├── main.py           # FastAPI application & API routes
│   └── scraper.py        # Playwright scraper, SEO analyzer, owner finder
├── frontend/
│   ├── index.html        # Single-page application
│   ├── css/style.css     # Dark theme UI
│   └── js/app.js         # Frontend logic
├── data/                 # SQLite database (auto-created)
├── run.py                # Application entry point
├── pyproject.toml        # Python dependencies
└── README.md
```

## License
MIT
