#!/usr/bin/env node

/**
 * Database setup script — creates the PostgreSQL database and tables automatically.
 * Run: npm run setup-db
 *
 * Requires PostgreSQL to be installed and running.
 * Defaults: user=postgres, password=admin, host=localhost, port=5432, database=leadscraper
 * Override with DATABASE_URL environment variable.
 */

import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:admin@localhost:5432/leadscraper";

function parseDbUrl(url) {
  const lastSlash = url.lastIndexOf("/");
  return {
    base: url.substring(0, lastSlash) + "/postgres",
    dbName: url.substring(lastSlash + 1).split("?")[0],
  };
}

async function main() {
  const { base, dbName } = parseDbUrl(DATABASE_URL);

  console.log(`Connecting to PostgreSQL...`);

  // Step 1: Create database if it doesn't exist
  const adminPool = new pg.Pool({ connectionString: base });
  try {
    const result = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (result.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created`);
    } else {
      console.log(`Database "${dbName}" already exists`);
    }
  } finally {
    await adminPool.end();
  }

  // Step 2: Create tables
  const appPool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await appPool.query(`
      CREATE TABLE IF NOT EXISTS scrape_sessions (
        id TEXT PRIMARY KEY,
        niche TEXT NOT NULL,
        area TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        total_found INTEGER DEFAULT 0,
        total_scraped INTEGER DEFAULT 0,
        total_skipped INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        business_name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        website TEXT DEFAULT '',
        has_website BOOLEAN DEFAULT FALSE,
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
        has_ssl BOOLEAN DEFAULT FALSE,
        has_mobile_viewport BOOLEAN DEFAULT FALSE,
        has_schema BOOLEAN DEFAULT FALSE,
        page_speed REAL,
        issues_count INTEGER DEFAULT 0,
        audit_report TEXT DEFAULT '{}',
        approach_status TEXT DEFAULT 'not_contacted',
        pipeline_stage TEXT DEFAULT 'new',
        notes TEXT DEFAULT '',
        owner_name TEXT DEFAULT '',
        scrape_session_id TEXT REFERENCES scrape_sessions(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await appPool.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_niche_area ON leads(niche, area);
      CREATE INDEX IF NOT EXISTS idx_leads_overall_score ON leads(overall_score DESC);
      CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_stage);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_name_gmb ON leads(business_name, gmb_link);
    `);

    console.log("Tables and indexes created successfully");
  } finally {
    await appPool.end();
  }

  console.log("\nSetup complete! Run 'npm run dev' to start the app.");
  console.log(`\npgAdmin4 connection details:`);
  console.log(`  Host: localhost`);
  console.log(`  Port: 5432`);
  console.log(`  Database: ${dbName}`);
  console.log(`  Username: postgres`);
  console.log(`  Password: admin`);
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  console.error(
    "\nMake sure PostgreSQL is installed and running on localhost:5432"
  );
  console.error(
    "Or set DATABASE_URL environment variable to your PostgreSQL connection string"
  );
  process.exit(1);
});
