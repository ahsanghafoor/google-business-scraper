import { Pool, type QueryResultRow } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:admin@localhost:5432/leadscraper";

let pool: Pool | null = null;
let initialized = false;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  if (initialized) return;

  const p = getPool();

  await p.query(`
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

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_niche_area ON leads(niche, area);
    CREATE INDEX IF NOT EXISTS idx_leads_overall_score ON leads(overall_score DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_stage);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_name_gmb ON leads(business_name, gmb_link);
  `);

  initialized = true;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: (string | number | boolean | null)[]
): Promise<T[]> {
  await initDb();
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: (string | number | boolean | null)[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
