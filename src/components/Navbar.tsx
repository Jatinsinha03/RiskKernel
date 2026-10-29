"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVault } from "@/context/VaultContext";
import { formatAddress } from "@/lib/web3";
import { 
  ShieldCheck, 
  LayoutDashboard, 
  SlidersHorizontal, 
  Sparkles, 
  CheckCheck, 
  TrendingUp, 
  Plus, 
  Wallet, 
  ExternalLink,
  RefreshCw,
  Home,
  Settings
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const { 
    walletAddress, 
    isConnected, 
    isAuthenticating, 
    connectWallet, 
    disconnectWallet, 
    vaults, 
    selectedVault, 
    selectVault,
    network,
    switchNetwork,
    refreshVault
  } = useVault();

  const navLinks = [
    { href: "/", label: "Overview", icon: Home },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/policy", label: "Policy Mandate", icon: SlidersHorizontal },
    { href: "/chat", label: "AI Copilot", icon: Sparkles },
    { 
      href: "/approvals", 
      label: "Approvals", 
      icon: CheckCheck, 
      badge: selectedVault?.pendingPolicy ? "1" : undefined 
    },
    { href: "/opportunities", label: "Arbitrage Feed", icon: TrendingUp },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#0b0d13]/90 backdrop-blur-xl border-b border-white/10 px-4 sm:px-8 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
        {/* Brand Logo */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-600/20 group-hover:scale-105 transition-all">
              <ShieldCheck className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg text-white tracking-tight">
                  Risk Kernel
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  HashKey
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium hidden sm:block">Deterministic On-Chain Invariants</p>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1.5">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  id={`nav-link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? "bg-white/10 text-white shadow-sm font-bold"
                      : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                  <span>{link.label}</span>
                  {link.badge && (
                    <span className="ml-1 px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side controls: Vault Selector, Chain Switcher, Wallet */}
        <div className="flex items-center gap-3">
          {/* Active Vault Dropdown */}
          {vaults.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#141721] border border-white/10 text-sm">
              <div className={`w-2.5 h-2.5 rounded-full ${
                selectedVault?.status === "ACTIVE" 
                  ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" 
                  : selectedVault?.status === "PAUSED" 
                  ? "bg-amber-400" 
                  : "bg-rose-500"
              }`} />
              <span className="text-slate-400 font-medium">Vault:</span>
              <select
                value={selectedVault?.address || ""}
                onChange={(e) => selectVault(e.target.value)}
                className="bg-transparent text-slate-200 font-mono text-xs font-bold focus:outline-none cursor-pointer"
                id="vault-selector"
              >
                {vaults.map((v) => (
                  <option key={v.address} value={v.address} className="bg-[#141721] text-white">
                    {formatAddress(v.address)} (${parseFloat(v.balance).toLocaleString()})
                  </option>
                ))}
              </select>
              <button 
                onClick={() => refreshVault()} 
                title="Refresh state" 
                className="text-slate-400 hover:text-indigo-400 transition-colors p-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* New Vault Button */}
          <Link
            href="/onboarding"
            id="create-vault-btn"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden md:inline">New Vault</span>
          </Link>

          {/* Network Switcher */}
          <button
            onClick={() => switchNetwork()}
            title="Switch HashKey Chain in MetaMask"
            id="network-switch-btn"
            className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#141721] hover:bg-[#1a1f2c] border border-white/10 text-xs text-slate-300 font-mono transition-colors font-medium"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>{network.chainName.split(" ")[0]} ({network.chainId})</span>
          </button>

          {/* Wallet Sign In / Connect */}
          {isConnected && walletAddress ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#141721] border border-white/10 text-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                <span className="font-mono text-slate-200 text-xs font-semibold">{formatAddress(walletAddress)}</span>
              </div>
              <button
                onClick={disconnectWallet}
                id="wallet-disconnect-btn"
                className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-rose-400 rounded-xl hover:bg-white/5 transition-colors"
                title="Disconnect wallet"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isAuthenticating}
              id="wallet-connect-btn"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50"
            >
              <Wallet className="w-4 h-4" />
              <span>{isAuthenticating ? "Authenticating..." : "Connect MetaMask"}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
