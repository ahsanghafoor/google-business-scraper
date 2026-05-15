# LeadScraper Pro — Freelance Lead Generation System

A full-stack Next.js application that scrapes Google Maps to find businesses with weak websites, poor SEO, and outreach opportunities. Includes AI-powered lead scoring, website audit reports, and a pipeline CRM — all in one tool.

## Features

### Lead Search & Scraping
- **Google Maps Scraper** — Search any niche + city to find businesses using Puppeteer (headless browser)
- **Duplicate Detection** — Automatically skips already-scraped businesses
- **Real-time Progress** — Live scraping progress with stage indicators
- **Batch Scraping** — Scrape up to 50 businesses per search

### Website Analysis & Scoring
- **13-Point SEO Audit** — SSL, page speed, meta tags, H1, mobile viewport, schema markup, robots.txt, sitemap, Open Graph, canonical tags, image alt tags
- **Lead Scoring (0-100)** — Composite score based on website quality, SEO health, GMB optimization, and review reputation
- **Hot/Warm/Cold Classification** — Automatically categorize leads by opportunity level

### Data Collected
- Business name, phone, email, address
- Website URL and full audit
- Google Maps link
- Rating and review count
- Business category

### Lead Management
- **Leads Table** — Filter by type, status, website presence; sort by score, rating, date
- **Lead Details** — Full audit report with pass/fail checks for each SEO factor
- **Status Tracking** — Not Contacted → Emailed / Called / Messaged → Follow Up → Converted / Lost
- **Pipeline CRM** — Kanban-style drag-and-drop board (New → Contacted → Qualified → Proposal → Negotiation → Won/Lost)
- **Notes** — Add notes to each lead
- **CSV Export** — Export filtered leads with all data

## Tech Stack
- **Framework**: Next.js 16 (App Router, TypeScript)
- **Scraper**: Puppeteer (headless Chromium)
- **Analysis**: Cheerio (HTML parsing), fetch (HTTP requests)
- **Database**: PostgreSQL (with Docker Compose + pgAdmin4)
- **UI**: Tailwind CSS (dark theme)
- **Scoring**: Custom heuristic algorithm

## Quick Start

### Prerequisites
- Node.js 18+
- npm
- Docker & Docker Compose (for PostgreSQL + pgAdmin4)

### Installation

```bash
# Clone the repo
git clone <repo-url>
cd google-business-scraper

# Start PostgreSQL + pgAdmin4
docker compose up -d

# Install dependencies
npm install

# Copy env file (defaults work out of the box with Docker Compose)
cp .env.example .env

# Run the dev server
npm run dev
```

The app will be available at **http://localhost:3000**

### pgAdmin4 — Database Admin

Access pgAdmin4 at **http://localhost:5050**

- **Email**: `admin@admin.com`
- **Password**: `admin`

To connect to the PostgreSQL database in pgAdmin4:
1. Open http://localhost:5050 and login
2. Right-click "Servers" → "Register" → "Server"
3. **General tab** — Name: `LeadScraper`
4. **Connection tab**:
   - Host: `postgres` (if pgAdmin runs inside Docker) or `localhost` (if running pgAdmin externally)
   - Port: `5432`
   - Database: `leadscraper`
   - Username: `postgres`
   - Password: `admin`
5. Click "Save"

### Windows Users
The app is fully compatible with Windows. Just run:
```bash
docker compose up -d
npm install
cp .env.example .env
npm run dev
```

Puppeteer will automatically download Chromium on first install.

## Usage

### 1. Search for Leads
- Go to **Search Leads** in the sidebar
- Enter a business niche (e.g., "Plumber") and location (e.g., "Dallas, TX")
- Select max results (10-50)
- Click **Search** and watch the real-time progress

### 2. Review Results
- Each lead shows an opportunity score (0-100), rating, issues count, and lead type
- Click any lead to see the full website audit report
- Filter by hot/warm/cold, contact status, or website presence

### 3. Manage Pipeline
- Go to **Pipeline** for a Kanban-style CRM board
- Drag and drop leads between stages
- Track your outreach progress

### 4. Export Data
- Click **Export CSV** to download all leads with full data
- Filter before exporting to get targeted lists

## Project Structure
```
google-business-scraper/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── scrape/          # Scraping endpoints
│   │   │   ├── leads/           # Lead CRUD + export
│   │   │   └── stats/           # Dashboard statistics
│   │   ├── dashboard/
│   │   │   ├── page.tsx         # Dashboard overview
│   │   │   ├── search/          # Search page
│   │   │   ├── leads/           # Leads table + detail
│   │   │   └── pipeline/        # Kanban CRM
│   │   ├── layout.tsx
│   │   └── page.tsx             # Redirects to /dashboard
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── ScoreBar.tsx
│   │   └── LeadBadge.tsx
│   ├── lib/
│   │   ├── db.ts                # PostgreSQL connection pool
│   │   ├── scraper.ts           # Google Maps scraper
│   │   ├── analyzer.ts          # Website SEO analyzer
│   │   └── scrape-manager.ts    # Scrape session orchestrator
│   └── types/
│       └── index.ts             # TypeScript types
├── docker-compose.yml           # PostgreSQL + pgAdmin4
├── .env.example                 # Environment variables
├── package.json
└── README.md
```

## License
MIT
