"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/types";
import LeadBadge from "@/components/LeadBadge";

const PIPELINE_STAGES = [
  { id: "new", label: "New", color: "border-gray-500" },
  { id: "contacted", label: "Contacted", color: "border-blue-500" },
  { id: "qualified", label: "Qualified", color: "border-purple-500" },
  { id: "proposal", label: "Proposal", color: "border-yellow-500" },
  { id: "negotiation", label: "Negotiation", color: "border-orange-500" },
  { id: "won", label: "Won", color: "border-green-500" },
  { id: "lost", label: "Lost", color: "border-red-500" },
];

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leads?limit=500&sort_by=overall_score&sort_order=DESC")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setLeads(data.leads || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch leads:", err);
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const moveLead = async (leadId: string, newStage: string) => {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId ? { ...l, pipeline_stage: newStage } : l
      )
    );

    try {
      await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage: newStage }),
      });
    } catch (err) {
      console.error("Failed to move lead:", err);
      setRefreshKey((k) => k + 1); // Revert on error
    }
  };

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData("text/plain", leadId);
    setDraggingId(leadId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/plain");
    if (leadId) {
      moveLead(leadId, stageId);
    }
    setDraggingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline CRM</h1>
          <p className="text-gray-400 text-sm mt-1">
            Drag and drop leads between stages to track progress
          </p>
        </div>
        <Link
          href="/dashboard/search"
          className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          + New Search
        </Link>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map((stage) => {
          const stageLeads = leads.filter(
            (l) => l.pipeline_stage === stage.id
          );

          return (
            <div
              key={stage.id}
              className={`flex-shrink-0 w-72 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl ${
                draggingId ? "border-dashed" : ""
              }`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, stage.id)}
            >
              <div className={`p-3 border-b-2 ${stage.color} flex items-center justify-between`}>
                <h3 className="text-sm font-semibold text-white">{stage.label}</h3>
                <span className="text-xs bg-[#252830] text-gray-400 px-2 py-0.5 rounded-full">
                  {stageLeads.length}
                </span>
              </div>

              <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-250px)] overflow-y-auto">
                {stageLeads.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center py-8">
                    Drop leads here
                  </p>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      className={`bg-[#252830] border border-[#2a2d3a] rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-[#3a3d4a] transition-colors ${
                        draggingId === lead.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="text-sm font-medium text-white hover:text-green-400 truncate flex-1"
                        >
                          {lead.business_name}
                        </Link>
                        <div className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold ml-2 flex-shrink-0 ${
                          lead.overall_score >= 70
                            ? "bg-red-500/20 text-red-400"
                            : lead.overall_score >= 40
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "bg-green-500/20 text-green-400"
                        }`}>
                          {lead.overall_score}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 truncate mb-2">
                        {lead.category || lead.niche} &middot; {lead.area}
                      </p>
                      <div className="flex items-center justify-between">
                        <LeadBadge type={lead.lead_type} size="sm" />
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          {lead.rating ?? "N/A"}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
