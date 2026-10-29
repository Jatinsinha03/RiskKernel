"use client";

import React, { useEffect, useState } from "react";
import { useVault } from "@/context/VaultContext";
import { getExplorerTxUrl, formatAddress } from "@/lib/web3";
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  TrendingUp, 
  ShieldAlert, 
  SlidersHorizontal, 
  Clock, 
  Key, 
  ExternalLink,
  Pause,
  Play
} from "lucide-react";

interface EventItem {
  id: string;
  eventType: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  details: Record<string, unknown>;
}

export function ActivityFeed() {
  const { selectedVault, network } = useVault();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!selectedVault?.address) return;

    const fetchEvents = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/vaults/${selectedVault.address}/activity`);
        const data = await res.json();
        if (data.events) {
          setEvents(data.events);
        }
      } catch (e) {
        console.error("Failed to load activity:", e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvents();
  }, [selectedVault?.address]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case "DEPOSIT":
        return <ArrowDownLeft className="w-5 h-5 text-indigo-400" />;
      case "WITHDRAW":
        return <ArrowUpRight className="w-5 h-5 text-emerald-400" />;
      case "TRADE_EXECUTED":
        return <TrendingUp className="w-5 h-5 text-emerald-400" />;
      case "CIRCUIT_BREAKER_TRIPPED":
        return <ShieldAlert className="w-5 h-5 text-rose-400" />;
      case "POLICY_UPDATE":
        return <SlidersHorizontal className="w-5 h-5 text-indigo-400" />;
      case "POLICY_QUEUED":
        return <Clock className="w-5 h-5 text-amber-400" />;
      case "PAUSED":
        return <Pause className="w-5 h-5 text-amber-400" />;
      case "UNPAUSED":
        return <Play className="w-5 h-5 text-emerald-400" />;
      case "AGENT_GRANTED":
      case "AGENT_REVOKED":
        return <Key className="w-5 h-5 text-indigo-400" />;
      default:
        return <SlidersHorizontal className="w-5 h-5 text-slate-400" />;
    }
  };

  const formatEventType = (type: string) => {
    return type.replace(/_/g, " ");
  };

  if (!selectedVault) return null;

  return (
    <div className="openui-card p-6 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>On-Chain Activity Feed</span>
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Indexed transactions verified from HashKey Blockscout
          </p>
        </div>
        <span className="text-sm text-slate-400 font-mono font-medium">
          {events.length} Events Logged
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[#0e111a] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">
          No transactions indexed for this vault yet.
        </div>
      ) : (
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
          {events.map((evt) => (
            <div
              key={evt.id}
              className="p-4 rounded-2xl bg-[#0e111a] hover:bg-[#141824] border border-white/5 transition-colors flex items-center justify-between gap-4 text-sm"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  {getEventIcon(evt.eventType)}
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-white">
                      {formatEventType(evt.eventType)}
                    </span>
                    {Boolean(evt.details?.netProfit) && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold badge-emerald">
                        {String(evt.details.netProfit)}
                      </span>
                    )}
                    {Boolean(evt.details?.simulatedLoss) && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold badge-rose">
                        {String(evt.details.simulatedLoss)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono">{new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>•</span>
                    {Boolean(evt.details?.amount) && <span>Amount: <strong className="text-white">{String(evt.details.amount)} USDT</strong></span>}
                    {Boolean(evt.details?.route) && <span>Route: {JSON.stringify(evt.details.route)}</span>}
                    {Boolean(evt.details?.initialPolicy) && <span>{String(evt.details.initialPolicy)}</span>}
                    {Boolean(evt.details?.reason) && <span className="text-rose-300 font-medium">{String(evt.details.reason)}</span>}
                  </div>
                </div>
              </div>

              {/* Tx Hash Link to Blockscout */}
              <a
                href={getExplorerTxUrl(evt.txHash, network)}
                target="_blank"
                rel="noreferrer"
                id={`explorer-link-${evt.id}`}
                className="flex items-center gap-1.5 font-mono text-xs text-indigo-400 hover:text-indigo-300 shrink-0 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 font-bold"
                title="View on HashKey Blockscout"
              >
                <span>{formatAddress(evt.txHash, 3)}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
