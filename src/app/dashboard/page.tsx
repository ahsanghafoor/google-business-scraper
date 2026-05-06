"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardStats } from "@/types";
import LeadBadge from "@/components/LeadBadge";
import ScoreBar from "@/components/ScoreBar";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-bold text-white mb-2">Welcome to LeadScraper Pro</h2>
        <p className="text-gray-400 mb-6">Start by searching for businesses in your target niche and area.</p>
        <Link
          href="/dashboard/search"
          className="inline-flex items-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Start Your First Search
        </Link>
      </div>
    );
  }

  const metricCards = [
    { label: "Total Leads", value: stats.total_leads, color: "text-white", bg: "bg-[#1a1d27]" },
    { label: "Hot Leads", value: stats.hot_leads, color: "text-red-400", bg: "bg-red-500/10" },
    { label: "Warm Leads", value: stats.warm_leads, color: "text-yellow-400", bg: "bg-yellow-500/10" },
    { label: "Cold Leads", value: stats.cold_leads, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Avg Score", value: stats.avg_score, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Searches", value: stats.total_sessions, color: "text-purple-400", bg: "bg-purple-500/10" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Overview of your lead generation pipeline</p>
        </div>
        <Link
          href="/dashboard/search"
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Search
        </Link>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className={`${card.bg} border border-[#2a2d3a] rounded-xl p-4`}
          >
            <p className="text-xs text-gray-400 mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Leads */}
        <div className="lg:col-span-2 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl">
          <div className="p-4 border-b border-[#2a2d3a] flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent Leads</h2>
            <Link href="/dashboard/leads" className="text-xs text-green-400 hover:text-green-300">
              View All
            </Link>
          </div>
          <div className="divide-y divide-[#2a2d3a]">
            {stats.recent_leads.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No leads yet. Start a search to find businesses.
              </div>
            ) : (
              stats.recent_leads.slice(0, 5).map((lead) => (
                <Link
                  key={lead.id}
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex items-center gap-4 p-4 hover:bg-[#252830] transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#252830] flex items-center justify-center text-sm font-bold text-green-400">
                    {lead.overall_score}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {lead.business_name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {lead.category || lead.niche} &middot; {lead.area}
                    </p>
                  </div>
                  <LeadBadge type={lead.lead_type} size="sm" />
                  <div className="text-right hidden sm:block">
                    <div className="flex items-center gap-1 text-xs text-yellow-400">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      {lead.rating ?? "N/A"}
                    </div>
                    <p className="text-xs text-gray-500">
                      {lead.review_count ?? 0} reviews
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Sidebar widgets */}
        <div className="space-y-6">
          {/* Pipeline breakdown */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4">
            <h3 className="font-semibold text-white mb-4">Pipeline</h3>
            {stats.pipeline.length === 0 ? (
              <p className="text-xs text-gray-500">No leads in pipeline</p>
            ) : (
              <div className="space-y-3">
                {stats.pipeline.map((p) => (
                  <ScoreBar
                    key={p.stage}
                    score={Math.round((p.count / stats.total_leads) * 100)}
                    label={p.stage}
                    size="sm"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Top niches */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4">
            <h3 className="font-semibold text-white mb-4">Top Niches</h3>
            {stats.niches.length === 0 ? (
              <p className="text-xs text-gray-500">No niches searched yet</p>
            ) : (
              <div className="space-y-2">
                {stats.niches.map((n) => (
                  <div
                    key={n.niche}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-300 truncate">{n.niche}</span>
                    <span className="text-gray-500 text-xs ml-2">{n.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Website stats */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4">
            <h3 className="font-semibold text-white mb-4">Website Status</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">With Website</span>
                <span className="text-sm text-green-400 font-medium">
                  {stats.leads_with_website}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">No Website</span>
                <span className="text-sm text-red-400 font-medium">
                  {stats.leads_without_website}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
