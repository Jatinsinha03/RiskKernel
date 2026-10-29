import { AgentConfig } from "./config";
import { CandidateCycle } from "./scanner";
import { EconomicAssessment } from "./economics";

export interface EvaluatedOpportunity {
  candidate: CandidateCycle;
  amountIn: bigint;
  economics: EconomicAssessment;
  requiresApproval: boolean;
}

export interface AiSelectionResult {
  selectedCandidateId: string;
  reason: string;
  score: number;
}

export class AiService {
  constructor(private config: AgentConfig) {}

  /**
   * Gemini evaluates and ranks candidate opportunities
   * Strictly constrained: the AI only selects among pre-validated candidates and cannot alter numbers.
   */
  public async selectOpportunity(
    candidates: EvaluatedOpportunity[]
  ): Promise<AiSelectionResult> {
    if (candidates.length === 0) {
      throw new Error("No candidates to select from");
    }

    // Default fallback: candidate with highest net profit
    let topCandidate = candidates[0];
    for (const c of candidates) {
      if (c.economics.netProfitUsdt > topCandidate.economics.netProfitUsdt) {
        topCandidate = c;
      }
    }

    const fallbackResult: AiSelectionResult = {
      selectedCandidateId: topCandidate.candidate.id,
      reason: `Selected highest net profit opportunity ($${topCandidate.economics.netProfitUsdt.toFixed(4)} USDT)`,
      score: 1.0,
    };

    if (this.config.aiMode !== "select" || !this.config.geminiApiKey) {
      return fallbackResult;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout

      const candidateSummary = candidates.slice(0, 5).map((c) => ({
        id: c.candidate.id,
        name: c.candidate.name,
        tradeAmountUsdt: (Number(c.amountIn) / 1e6).toFixed(2),
        grossProfitUsdt: c.economics.grossProfitUsdt.toFixed(4),
        gasCostUsdt: c.economics.gasCostUsdt.toFixed(4),
        netProfitUsdt: c.economics.netProfitUsdt.toFixed(4),
        netProfitBps: c.economics.netProfitBps,
        requiresApproval: c.requiresApproval,
      }));

      const prompt = `You are the Risk Kernel AI Agent selector on HashKey Chain.
Evaluate the following pre-validated arbitrage cycles. Select the single best candidate based on execution risk, liquidity, and risk-adjusted net return.

Candidates:
${JSON.stringify(candidateSummary, null, 2)}

Respond with STRICT JSON only in the following schema:
{
  "selectedCandidateId": "string (must match one candidate id exactly)",
  "reason": "short 1 sentence explanation",
  "score": number between 0 and 1
}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.geminiModel}:generateContent?key=${this.config.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        }
      );

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text) as AiSelectionResult;
          const match = candidates.find((c) => c.candidate.id === parsed.selectedCandidateId);
          if (match) {
            return {
              selectedCandidateId: parsed.selectedCandidateId,
              reason: parsed.reason || fallbackResult.reason,
              score: typeof parsed.score === "number" ? parsed.score : 0.9,
            };
          }
        }
      }
    } catch (err) {
      console.warn("AI candidate selection timed out or failed, using deterministic fallback:", err);
    }

    return fallbackResult;
  }

  /**
   * Generates a plain-language summary after transaction execution
   */
  public async explainTrade(
    cycleName: string,
    tradeAmountUsdt: string,
    netProfitUsdt: string,
    txHash: string
  ): Promise<string> {
    const template = `Executed ${cycleName} with size ${tradeAmountUsdt} USDT, locking in ${netProfitUsdt} USDT net profit on HashKey Chain.`;

    if (!this.config.geminiApiKey) return template;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.geminiModel}:generateContent?key=${this.config.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Summarize this confirmed trade on HashKey Chain in one factual, reassuring sentence for the vault owner:
Cycle: ${cycleName}
Amount: ${tradeAmountUsdt} USDT
Profit: ${netProfitUsdt} USDT
TxHash: ${txHash}`,
                  },
                ],
              },
            ],
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (summary) return summary;
      }
    } catch {
      // Fallback
    }

    return template;
  }
}
