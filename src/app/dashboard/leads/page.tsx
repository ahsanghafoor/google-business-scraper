"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/types";
import LeadBadge from "@/components/LeadBadge";

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterWebsite, setFilterWebsite] = useState("");
  const [sortBy, setSortBy] = useState("overall_score");
  const [sortOrder, setSortOrder] = useState("DESC");
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const limit = 50;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterType) params.set("lead_type", filterType);
    if (filterStatus) params.set("status", filterStatus);
    if (filterWebsite) params.set("has_website", filterWebsite);
    params.set("sort_by", sortBy);
    params.set("sort_order", sortOrder);
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    fetch(`/api/leads?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setLeads(data.leads || []);
          setTotal(data.total || 0);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch leads:", err);
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [search, filterType, filterStatus, filterWebsite, sortBy, sortOrder, offset, refreshKey]);



  const handleExport = () => {
    const params = new URLSearchParams();
    if (filterType) params.set("lead_type", filterType);
    window.location.href = `/api/leads/export?${params.toString()}`;
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
    setRefreshKey((k) => k + 1);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">All Leads</h1>
          <p className="text-gray-400 text-sm mt-1">{total} total leads</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm bg-[#1a1d27] border border-[#2a2d3a] text-gray-300 rounded-lg hover:text-white hover:border-[#3a3d4a] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
          <Link
            href="/dashboard/search"
            className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Search
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            placeholder="Search businesses..."
            className="px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setOffset(0); }}
            className="px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
          >
            <option value="">All Types</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setOffset(0); }}
            className="px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
          >
            <option value="">All Statuses</option>
            <option value="not_contacted">Not Contacted</option>
            <option value="emailed">Emailed</option>
            <option value="called">Called</option>
            <option value="follow_up">Follow Up</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
          </select>
          <select
            value={filterWebsite}
            onChange={(e) => { setFilterWebsite(e.target.value); setOffset(0); }}
            className="px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
          >
            <option value="">Website: All</option>
            <option value="true">Has Website</option>
            <option value="false">No Website</option>
          </select>
          <select
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [sb, so] = e.target.value.split(":");
              setSortBy(sb);
              setSortOrder(so);
              setOffset(0);
            }}
            className="px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
          >
            <option value="overall_score:DESC">Score (High to Low)</option>
            <option value="overall_score:ASC">Score (Low to High)</option>
            <option value="created_at:DESC">Newest First</option>
            <option value="created_at:ASC">Oldest First</option>
            <option value="business_name:ASC">Name (A-Z)</option>
            <option value="rating:DESC">Rating (High to Low)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-400">No leads found. Start a search to find businesses.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a2d3a]">
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Score</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Business</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden md:table-cell">Category</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden md:table-cell">Rating</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden lg:table-cell">SEO</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 hidden lg:table-cell">Issues</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Type</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a2d3a]">
                  {leads.map((lead) => (
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
                        <Link href={`/dashboard/leads/${lead.id}`} className="hover:text-green-400">
                          <p className="text-sm font-medium text-white">{lead.business_name}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[200px]">
                            {lead.area} &middot; {lead.phone || "No phone"}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">{lead.category || "-"}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-1 text-xs">
                          <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          <span className="text-gray-300">{lead.rating ?? "N/A"}</span>
                          <span className="text-gray-500">({lead.review_count ?? 0})</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className={`text-xs font-medium ${
                          lead.seo_score >= 70 ? "text-green-400" : lead.seo_score >= 40 ? "text-yellow-400" : "text-red-400"
                        }`}>{lead.seo_score}/100</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className={`text-xs ${lead.issues_count >= 8 ? "text-red-400" : "text-yellow-400"}`}>
                          {lead.issues_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <LeadBadge type={lead.lead_type} size="sm" />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          lead.approach_status === "converted"
                            ? "bg-green-500/20 text-green-400"
                            : lead.approach_status === "not_contacted"
                              ? "bg-gray-500/20 text-gray-400"
                              : "bg-blue-500/20 text-blue-400"
                        }`}>
                          {lead.approach_status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/leads/${lead.id}`}
                            className="text-xs text-green-400 hover:text-green-300"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => handleDelete(lead.id)}
                            className="text-xs text-gray-500 hover:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#2a2d3a]">
                <p className="text-xs text-gray-400">
                  Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={offset === 0}
                    className="px-3 py-1 text-xs bg-[#252830] text-gray-300 rounded disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setOffset(offset + limit)}
                    disabled={offset + limit >= total}
                    className="px-3 py-1 text-xs bg-[#252830] text-gray-300 rounded disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
