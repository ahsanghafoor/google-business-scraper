"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { Lead, ScrapeProgress } from "@/types";
import LeadBadge from "@/components/LeadBadge";

const POPULAR_NICHES = [
  "Plumber", "Electrician", "Dentist", "Restaurant", "Lawyer",
  "Roofing", "HVAC", "Landscaping", "Auto Repair", "Real Estate Agent",
  "Chiropractor", "Veterinarian", "Hair Salon", "Gym", "Accountant",
  "Cleaning Service", "Pest Control", "Moving Company", "Florist", "Photographer",
];

export default function SearchPage() {
  const [niche, setNiche] = useState("");
  const [area, setArea] = useState("");
  const [maxResults, setMaxResults] = useState(20);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);
  const [results, setResults] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function pollProgress(sid: string) {
    fetch(`/api/scrape/${sid}/progress`)
      .then((res) => res.json())
      .then(async (data: ScrapeProgress) => {
        setProgress(data);
        if (data.stage === "completed" || data.stage === "error") {
          setIsSearching(false);
          const leadsRes = await fetch(`/api/leads?session_id=${sid}&sort_by=overall_score&sort_order=DESC`);
          const leadsData = await leadsRes.json();
          setResults(leadsData.leads || []);
        } else {
          pollRef.current = setTimeout(() => pollProgress(sid), 2000);
        }
      })
      .catch(() => {
        pollRef.current = setTimeout(() => pollProgress(sid), 3000);
      });
  }

  const handleSearch = async () => {
    if (!niche.trim() || !area.trim()) {
      setError("Please enter both a business niche and location");
      return;
    }

    setError("");
    setIsSearching(true);
    setResults([]);
    setProgress(null);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: niche.trim(), area: area.trim(), maxResults }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setIsSearching(false);
        return;
      }

      pollProgress(data.session_id);
    } catch {
      setError("Failed to start search. Please try again.");
      setIsSearching(false);
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (niche) params.set("niche", niche);
    if (area) params.set("area", area);
    window.location.href = `/api/leads/export?${params.toString()}`;
  };



  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Search Leads</h1>
        <p className="text-gray-400 text-sm mt-1">
          Find businesses with weak websites, poor SEO, and outreach opportunities
        </p>
      </div>

      {/* Search form */}
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Business Niche
            </label>
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="e.g. Plumber, Dentist, Restaurant"
              className="w-full px-4 py-3 bg-[#252830] border border-[#2a2d3a] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
              disabled={isSearching}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Location
            </label>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Dallas, TX"
              className="w-full px-4 py-3 bg-[#252830] border border-[#2a2d3a] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
              disabled={isSearching}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Max Results
            </label>
            <select
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="w-full px-4 py-3 bg-[#252830] border border-[#2a2d3a] rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors"
              disabled={isSearching}
            >
              <option value={10}>10 leads</option>
              <option value={20}>20 leads</option>
              <option value={30}>30 leads</option>
              <option value={50}>50 leads</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="w-full px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSearching ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Searching...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </>
              )}
            </button>
          </div>
        </div>

        {/* Popular niches */}
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="text-xs text-gray-500">Popular:</span>
          {POPULAR_NICHES.slice(0, 10).map((n) => (
            <button
              key={n}
              onClick={() => setNiche(n)}
              className="text-xs px-2 py-1 bg-[#252830] text-gray-400 rounded hover:text-green-400 hover:bg-green-500/10 transition-colors"
              disabled={isSearching}
            >
              {n}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Progress */}
      {isSearching && progress && (
        <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500" />
            <span className="text-sm font-medium text-white">
              {progress.stage === "launching_browser" && "Launching browser..."}
              {progress.stage === "loading_results" && "Loading Google Maps results..."}
              {progress.stage === "scrolling_results" && "Scrolling through results..."}
              {progress.stage === "found_listings" && `Found ${progress.total} listings. Starting analysis...`}
              {progress.stage === "scraping" && `Scraping business ${progress.scraped + progress.skipped}/${progress.total}...`}
              {progress.stage === "analyzing" && `Analyzing websites... ${progress.scraped}/${progress.total}`}
            </span>
          </div>
          {progress.total > 0 && (
            <div className="w-full bg-[#252830] rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(((progress.scraped + progress.skipped) / progress.total) * 100)}%`,
                }}
              />
            </div>
          )}
          {progress.current_business && (
            <p className="text-xs text-gray-400 mt-2">
              Current: {progress.current_business}
            </p>
          )}
          <div className="flex gap-4 mt-3 text-xs text-gray-400">
            <span>Found: {progress.total}</span>
            <span>Scraped: {progress.scraped}</span>
            <span>Skipped: {progress.skipped}</span>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl">
          <div className="p-4 border-b border-[#2a2d3a] flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">
                {results.length} Leads Found
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {results.filter((r) => r.lead_type === "hot").length} hot leads &middot;{" "}
                {results.filter((r) => !r.has_website).length} need websites
              </p>
            </div>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 text-xs bg-[#252830] text-gray-300 rounded-lg hover:text-white hover:bg-[#2a2d3a] transition-colors flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2a2d3a]">
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Score</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Business</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden md:table-cell">Category</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden lg:table-cell">Rating</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden lg:table-cell">Website</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden md:table-cell">Issues</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Type</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2d3a]">
                {results.map((lead) => (
                  <tr key={lead.id} className="hover:bg-[#252830] transition-colors">
                    <td className="px-4 py-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                        lead.overall_score >= 70
                          ? "bg-red-500/20 text-red-400"
                          : lead.overall_score >= 40
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-green-500/20 text-green-400"
                      }`}>
                        {lead.overall_score}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-white">{lead.business_name}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[200px]">{lead.address || lead.area}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-gray-400">{lead.category || "-"}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1">
                        <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        <span className="text-xs text-gray-300">{lead.rating ?? "N/A"}</span>
                        <span className="text-xs text-gray-500">({lead.review_count ?? 0})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {lead.has_website ? (
                        <span className="text-xs text-green-400">Has site</span>
                      ) : (
                        <span className="text-xs text-red-400">No site</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs font-medium ${
                        lead.issues_count >= 8 ? "text-red-400" : lead.issues_count >= 5 ? "text-yellow-400" : "text-green-400"
                      }`}>
                        {lead.issues_count} issues
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <LeadBadge type={lead.lead_type} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className="text-xs text-green-400 hover:text-green-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
