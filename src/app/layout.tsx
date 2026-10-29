import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { VaultProvider } from "@/context/VaultContext";
import { Navbar } from "@/components/Navbar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Risk Kernel | Deterministic Mandates & Circuit Breakers on HashKey Chain",
  description:
    "Smart contract risk management with deterministic loss-floor circuit breakers, directional mandate policy governance, and human-in-the-loop approvals for HashKey Chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full dark antialiased`}>
      <body className="min-h-full flex flex-col bg-[#090d16] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
        <VaultProvider>
          <Navbar />
          <main className="flex-1 flex flex-col">{children}</main>
          <footer className="glass-panel border-t border-white/5 py-6 px-4 lg:px-8 mt-auto">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300">Risk Kernel</span>
                <span>•</span>
                <span>HashKey Chain (Testnet &amp; Mainnet)</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-500 font-mono">
                <span>EVM Compatible</span>
                <span>EIP-712 Approvals</span>
                <span>Postgres &amp; Prisma Synced</span>
              </div>
            </div>
          </footer>
        </VaultProvider>
      </body>
    </html>
  );
}
