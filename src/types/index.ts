export interface Lead {
  id: string;
  business_name: string;
  phone: string;
  email: string;
  website: string;
  has_website: boolean;
  address: string;
  area: string;
  niche: string;
  gmb_link: string;
  category: string;
  rating: number | null;
  review_count: number | null;

  // Scores
  seo_score: number;
  gmb_score: number;
  website_score: number;
  overall_score: number;
  lead_type: "hot" | "warm" | "cold" | "new";

  // Audit
  has_ssl: boolean;
  has_mobile_viewport: boolean;
  has_schema: boolean;
  page_speed: number | null;
  issues_count: number;
  audit_report: string; // JSON

  // Management
  approach_status: string;
  pipeline_stage: string;
  notes: string;

  // Owner
  owner_name: string;

  // Metadata
  scrape_session_id: string;
  created_at: string;
  updated_at: string;
}

export interface ScrapeSession {
  id: string;
  niche: string;
  area: string;
  status: "running" | "completed" | "failed";
  total_found: number;
  total_scraped: number;
  total_skipped: number;
  created_at: string;
  completed_at: string | null;
}

export interface ScrapeProgress {
  session_id: string;
  stage: string;
  total: number;
  scraped: number;
  skipped: number;
  current_business?: string;
}

export interface DashboardStats {
  total_leads: number;
  hot_leads: number;
  warm_leads: number;
  cold_leads: number;
  total_sessions: number;
  leads_with_website: number;
  leads_without_website: number;
  avg_score: number;
  recent_leads: Lead[];
  niches: { niche: string; count: number }[];
  pipeline: { stage: string; count: number }[];
}

export interface AuditReport {
  ssl: { passed: boolean; detail: string };
  mobile_viewport: { passed: boolean; detail: string };
  meta_title: { passed: boolean; detail: string; value?: string };
  meta_description: { passed: boolean; detail: string; value?: string };
  h1_tag: { passed: boolean; detail: string; count?: number };
  schema_markup: { passed: boolean; detail: string };
  page_speed: { score: number; detail: string };
  https_redirect: { passed: boolean; detail: string };
  image_alt_tags: { passed: boolean; detail: string; missing?: number };
  canonical_tag: { passed: boolean; detail: string };
  robots_txt: { passed: boolean; detail: string };
  sitemap: { passed: boolean; detail: string };
  open_graph: { passed: boolean; detail: string };
}
