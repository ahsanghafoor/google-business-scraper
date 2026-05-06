import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "leads.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_sessions (
      id TEXT PRIMARY KEY,
      niche TEXT NOT NULL,
      area TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      total_found INTEGER DEFAULT 0,
      total_scraped INTEGER DEFAULT 0,
      total_skipped INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      has_website INTEGER DEFAULT 0,
      address TEXT DEFAULT '',
      area TEXT DEFAULT '',
      niche TEXT DEFAULT '',
      gmb_link TEXT DEFAULT '',
      category TEXT DEFAULT '',
      rating REAL,
      review_count INTEGER,

      seo_score REAL DEFAULT 0,
      gmb_score REAL DEFAULT 0,
      website_score REAL DEFAULT 0,
      overall_score REAL DEFAULT 0,
      lead_type TEXT DEFAULT 'new',

      has_ssl INTEGER DEFAULT 0,
      has_mobile_viewport INTEGER DEFAULT 0,
      has_schema INTEGER DEFAULT 0,
      page_speed REAL,
      issues_count INTEGER DEFAULT 0,
      audit_report TEXT DEFAULT '{}',

      approach_status TEXT DEFAULT 'not_contacted',
      pipeline_stage TEXT DEFAULT 'new',
      notes TEXT DEFAULT '',

      owner_name TEXT DEFAULT '',

      scrape_session_id TEXT REFERENCES scrape_sessions(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_niche_area ON leads(niche, area);
    CREATE INDEX IF NOT EXISTS idx_leads_overall_score ON leads(overall_score DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_stage);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_name_gmb ON leads(business_name, gmb_link);
  `);

  return db;
}
