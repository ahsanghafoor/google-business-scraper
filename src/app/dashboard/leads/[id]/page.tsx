"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import type { Lead, AuditReport } from "@/types";
import LeadBadge from "@/components/LeadBadge";
import ScoreBar from "@/components/ScoreBar";

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/leads/${id}`)
      .then((r) => r.json())
      .then(setLead)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const updateField = async (field: string, value: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const updated = await res.json();
      setLead(updated);
    } catch (err) {
      console.error("Update failed:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Lead not found</p>
        <Link href="/dashboard/leads" className="text-green-400 text-sm mt-2 inline-block">
          Back to leads
        </Link>
      </div>
    );
  }

  let audit: AuditReport | null = null;
  try {
    audit = JSON.parse(lead.audit_report);
  } catch {
    // ignore
  }

  const auditItems = audit
    ? Object.entries(audit).filter(
        ([key]) => key !== "error" && key !== "no_website"
      )
    : [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href="/dashboard/leads"
            className="text-xs text-gray-400 hover:text-green-400 mb-2 inline-flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to leads
          </Link>
          <h1 className="text-2xl font-bold text-white mt-1">{lead.business_name}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {lead.category || lead.niche} &middot; {lead.area}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LeadBadge type={lead.lead_type} />
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold ${
            lead.overall_score >= 70
              ? "bg-red-500/20 text-red-400 border border-red-500/30"
              : lead.overall_score >= 40
                ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                : "bg-green-500/20 text-green-400 border border-green-500/30"
          }`}>
            {lead.overall_score}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Scores */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6">
            <h2 className="font-semibold text-white mb-4">Opportunity Scores</h2>
            <div className="space-y-4">
              <ScoreBar score={lead.overall_score} label="Overall" size="lg" />
              <ScoreBar score={lead.seo_score} label="SEO" />
              <ScoreBar score={lead.gmb_score} label="GMB" />
              <ScoreBar score={lead.website_score} label="Website" />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-[#2a2d3a]">
              <div className="text-center">
                <p className="text-xs text-gray-400">Issues Found</p>
                <p className={`text-xl font-bold ${lead.issues_count >= 8 ? "text-red-400" : "text-yellow-400"}`}>
                  {lead.issues_count}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400">Rating</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="text-xl font-bold text-white">{lead.rating ?? "N/A"}</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400">Reviews</p>
                <p className="text-xl font-bold text-white">{lead.review_count ?? 0}</p>
              </div>
            </div>
          </div>

          {/* Audit Report */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6">
            <h2 className="font-semibold text-white mb-4">
              Website Audit Report
              {!lead.has_website && (
                <span className="text-xs text-red-400 ml-2 font-normal">No website detected</span>
              )}
            </h2>
            {auditItems.length > 0 ? (
              <div className="space-y-3">
                {auditItems.map(([key, check]) => {
                  const item = check as { passed?: boolean; detail?: string; score?: number };
                  const passed = item.passed ?? (item.score !== undefined && item.score >= 50);
                  return (
                    <div
                      key={key}
                      className={`flex items-start gap-3 p-3 rounded-lg ${
                        passed ? "bg-green-500/5" : "bg-red-500/5"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        passed ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {passed ? (
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white capitalize">
                          {key.replace(/_/g, " ")}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {item.detail || (passed ? "Passed" : "Failed")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {lead.has_website
                  ? "Audit data not available"
                  : "This business does not have a website. This is a strong opportunity for web development services."}
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact info */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-4">Contact Info</h3>
            <div className="space-y-3">
              <InfoRow label="Phone" value={lead.phone} />
              <InfoRow label="Email" value={lead.email} />
              <InfoRow label="Address" value={lead.address} />
              <InfoRow
                label="Website"
                value={lead.website}
                isLink={!!lead.website}
              />
              <InfoRow
                label="Google Maps"
                value={lead.gmb_link ? "View on Maps" : "N/A"}
                isLink={!!lead.gmb_link}
                href={lead.gmb_link}
              />
            </div>
          </div>

          {/* Status management */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-4">
              Lead Management
              {saving && <span className="text-xs text-green-400 ml-2">Saving...</span>}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Pipeline Stage</label>
                <select
                  value={lead.pipeline_stage}
                  onChange={(e) => updateField("pipeline_stage", e.target.value)}
                  className="w-full px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
                >
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="proposal">Proposal</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Approach Status</label>
                <select
                  value={lead.approach_status}
                  onChange={(e) => updateField("approach_status", e.target.value)}
                  className="w-full px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
                >
                  <option value="not_contacted">Not Contacted</option>
                  <option value="emailed">Emailed</option>
                  <option value="called">Called</option>
                  <option value="messaged">Messaged</option>
                  <option value="follow_up">Follow Up</option>
                  <option value="converted">Converted</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Lead Type</label>
                <select
                  value={lead.lead_type}
                  onChange={(e) => updateField("lead_type", e.target.value)}
                  className="w-full px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500"
                >
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                  <option value="new">New</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes</label>
                <textarea
                  value={lead.notes}
                  onChange={(e) => setLead({ ...lead, notes: e.target.value })}
                  onBlur={(e) => updateField("notes", e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 bg-[#252830] border border-[#2a2d3a] rounded-lg text-sm text-white focus:outline-none focus:border-green-500 resize-none"
                  placeholder="Add notes about this lead..."
                />
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-4">Quick Checks</h3>
            <div className="space-y-2">
              <CheckItem label="SSL Certificate" passed={lead.has_ssl} />
              <CheckItem label="Mobile Viewport" passed={lead.has_mobile_viewport} />
              <CheckItem label="Schema Markup" passed={lead.has_schema} />
              <CheckItem label="Has Website" passed={lead.has_website} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  isLink,
  href,
}: {
  label: string;
  value: string;
  isLink?: boolean;
  href?: string;
}) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      {isLink && (value || href) ? (
        <a
          href={href || value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-green-400 hover:text-green-300 truncate block"
        >
          {value || href}
        </a>
      ) : (
        <p className="text-sm text-white truncate">{value || "N/A"}</p>
      )}
    </div>
  );
}

function CheckItem({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
        passed ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
      }`}>
        {passed ? (
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      <span className="text-sm text-gray-300">{label}</span>
    </div>
  );
}
