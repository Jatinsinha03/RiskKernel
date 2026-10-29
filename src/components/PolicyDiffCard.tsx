"use client";

import React from "react";
import { PolicyEvaluation } from "@/lib/policy";
import { ShieldCheck, Clock, ArrowRight, CheckCircle2 } from "lucide-react";

interface PolicyDiffCardProps {
  evaluation: PolicyEvaluation;
  onConfirm?: () => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function PolicyDiffCard({
  evaluation,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: PolicyDiffCardProps) {
  const { isAllSafer, hasRiskier, diffs, summary } = evaluation;

  if (!diffs || diffs.length === 0) {
    return null;
  }

  return (
    <div className={`p-6 sm:p-8 transition-all ${
      hasRiskier ? "openui-card-warning" : "openui-card-elevated"
    }`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3.5">
          {isAllSafer ? (
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Clock className="w-6 h-6" />
            </div>
          )}
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2.5">
              <span>Proposed Mandate Modification</span>
              {isAllSafer ? (
                <span className="px-3 py-0.5 rounded-full text-xs font-bold badge-emerald">
                  SAFER (APPLIES INSTANTLY)
                </span>
              ) : (
                <span className="px-3 py-0.5 rounded-full text-xs font-bold badge-amber">
                  RISKIER (QUEUED IN TIMELOCK)
                </span>
              )}
            </h3>
            <p className="text-sm text-slate-400 mt-0.5">
              Directional risk invariant evaluated by Risk Kernel smart contract engine
            </p>
          </div>
        </div>
      </div>

      {/* Summary Alert */}
      <p className="text-sm text-slate-300 mb-6 leading-relaxed bg-[#0e111a] p-4 rounded-xl border border-white/5">
        {summary}
      </p>

      {/* Diffs Table */}
      <div className="space-y-4 mb-6">
        {diffs.map((diff, idx) => (
          <div
            key={idx}
            className="p-4 rounded-2xl bg-[#0e111a] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">{diff.label}</span>
                {diff.isSafer ? (
                  <span className="text-xs px-2 py-0.5 rounded-full badge-emerald font-bold">
                    Safer Direction
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full badge-amber font-bold">
                    Riskier Direction
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">{diff.reason}</p>
            </div>

            {/* Value Transition */}
            <div className="flex items-center gap-3 shrink-0 bg-[#161a25] px-4 py-2 rounded-xl border border-white/5 font-mono text-sm">
              <span className="text-slate-400 line-through">{String(diff.oldValue)}</span>
              <ArrowRight className="w-4 h-4 text-slate-500" />
              <span className={`font-bold ${diff.isSafer ? "text-emerald-400" : "text-amber-400"}`}>
                {String(diff.newValue)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <button
            onClick={onCancel}
            id="cancel-diff-btn"
            disabled={isSubmitting}
            className="px-5 py-3 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
        )}
        {onConfirm && (
          <button
            onClick={onConfirm}
            id="confirm-diff-btn"
            disabled={isSubmitting}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-lg ${
              isAllSafer
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25"
                : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/25"
            }`}
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>
              {isSubmitting
                ? "Submitting to HashKey Chain..."
                : isAllSafer
                ? "Confirm & Apply Instantly"
                : "Queue in Timelock Delay"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
