export interface PolicyFieldDiff {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
  isSafer: boolean;
  reason: string;
}

export interface PolicyEvaluation {
  isAllSafer: boolean;
  isSaferOverall: boolean;
  hasRiskier: boolean;
  diffs: PolicyFieldDiff[];
  summary: string;
  executionMode: "INSTANT" | "QUEUED_TIMELOCK";
}

export function evaluatePolicyChange(
  current: {
    maxDrawdownBps: number;
    maxPositionSize: number | string;
    maxDailyVolume: number | string;
    maxSlippageBps: number;
    approvalThreshold: number | string;
    agentAddress?: string | null;
    allowedTokens?: string[];
    allowedPools?: string[];
    allowedModules?: string[];
  },
  proposed: Partial<{
    maxDrawdownBps: number;
    maxPositionSize: number | string;
    maxDailyVolume: number | string;
    maxSlippageBps: number;
    approvalThreshold: number | string;
    agentAddress?: string | null;
    allowedTokens?: string[];
    allowedPools?: string[];
    allowedModules?: string[];
  }>
): PolicyEvaluation {
  const diffs: PolicyFieldDiff[] = [];

  // 1. Max Drawdown (Safer when goes down)
  if (
    proposed.maxDrawdownBps !== undefined &&
    proposed.maxDrawdownBps !== current.maxDrawdownBps
  ) {
    const isSafer = proposed.maxDrawdownBps < current.maxDrawdownBps;
    diffs.push({
      field: "maxDrawdownBps",
      label: "Max Drawdown Floor",
      oldValue: `${(current.maxDrawdownBps / 100).toFixed(1)}%`,
      newValue: `${(proposed.maxDrawdownBps / 100).toFixed(1)}%`,
      isSafer,
      reason: isSafer
        ? "Lowering drawdown tightens the circuit breaker (Safer)"
        : "Increasing drawdown allows deeper portfolio loss before halting (Riskier)",
    });
  }

  // 2. Max Position Size (Safer when goes down)
  if (
    proposed.maxPositionSize !== undefined &&
    Number(proposed.maxPositionSize) !== Number(current.maxPositionSize)
  ) {
    const isSafer = Number(proposed.maxPositionSize) < Number(current.maxPositionSize);
    diffs.push({
      field: "maxPositionSize",
      label: "Max Position Size",
      oldValue: `${Number(current.maxPositionSize).toLocaleString()} USDT`,
      newValue: `${Number(proposed.maxPositionSize).toLocaleString()} USDT`,
      isSafer,
      reason: isSafer
        ? "Smaller trade limit reduces single-trade exposure (Safer)"
        : "Higher trade limit increases per-trade risk (Riskier)",
    });
  }

  // 3. Max Daily Volume (Safer when goes down)
  if (
    proposed.maxDailyVolume !== undefined &&
    Number(proposed.maxDailyVolume) !== Number(current.maxDailyVolume)
  ) {
    const isSafer = Number(proposed.maxDailyVolume) < Number(current.maxDailyVolume);
    diffs.push({
      field: "maxDailyVolume",
      label: "Max Daily Volume",
      oldValue: `${Number(current.maxDailyVolume).toLocaleString()} USDT`,
      newValue: `${Number(proposed.maxDailyVolume).toLocaleString()} USDT`,
      isSafer,
      reason: isSafer
        ? "Lower daily cap caps agent turnover (Safer)"
        : "Higher turnover allowance increases cumulative trading risk (Riskier)",
    });
  }

  // 4. Max Slippage (Safer when goes down)
  if (
    proposed.maxSlippageBps !== undefined &&
    proposed.maxSlippageBps !== current.maxSlippageBps
  ) {
    const isSafer = proposed.maxSlippageBps < current.maxSlippageBps;
    diffs.push({
      field: "maxSlippageBps",
      label: "Max Slippage Allowance",
      oldValue: `${(current.maxSlippageBps / 100).toFixed(2)}%`,
      newValue: `${(proposed.maxSlippageBps / 100).toFixed(2)}%`,
      isSafer,
      reason: isSafer
        ? "Lower slippage enforces stricter price tolerance (Safer)"
        : "Looser slippage allows worse execution prices (Riskier)",
    });
  }

  // 5. Approval Threshold (Lower is safer; Turning ON from Off is safer; Turning OFF is riskier)
  const isCurrentOff = current.approvalThreshold === "Off" || String(current.approvalThreshold) === "340282366920938463463374607431768211455";
  const isProposedOff = proposed.approvalThreshold === "Off" || String(proposed.approvalThreshold) === "340282366920938463463374607431768211455";

  if (proposed.approvalThreshold !== undefined && isCurrentOff !== isProposedOff) {
    const isSafer = !isProposedOff; // Turning approval requirement ON is safer
    diffs.push({
      field: "approvalThreshold",
      label: "Human-in-the-Loop Threshold",
      oldValue: isCurrentOff ? "Off" : `${Number(current.approvalThreshold).toLocaleString()} USDT`,
      newValue: isProposedOff ? "Off" : `${Number(proposed.approvalThreshold).toLocaleString()} USDT`,
      isSafer,
      reason: isSafer
        ? "Enabling human-in-the-loop signatures adds an explicit sign-off layer (Safer)"
        : "Disabling human approval threshold removes trade signature requirement (Riskier)",
    });
  } else if (
    proposed.approvalThreshold !== undefined &&
    !isCurrentOff &&
    !isProposedOff &&
    Number(proposed.approvalThreshold) !== Number(current.approvalThreshold)
  ) {
    const isSafer = Number(proposed.approvalThreshold) < Number(current.approvalThreshold);
    diffs.push({
      field: "approvalThreshold",
      label: "Human-in-the-Loop Threshold",
      oldValue: `${Number(current.approvalThreshold).toLocaleString()} USDT`,
      newValue: `${Number(proposed.approvalThreshold).toLocaleString()} USDT`,
      isSafer,
      reason: isSafer
        ? "Lower threshold requires your explicit sign-off on more trades (Safer)"
        : "Higher threshold gives the agent more autonomy without confirmation (Riskier)",
    });
  }

  // 6. Agent Address (Revoking is safer; Granting or replacing is riskier)
  if (
    proposed.agentAddress !== undefined &&
    proposed.agentAddress !== current.agentAddress
  ) {
    const isRevoke = !proposed.agentAddress || proposed.agentAddress === "0x0000000000000000000000000000000000000000";
    diffs.push({
      field: "agentAddress",
      label: "Autonomous Agent Wallet",
      oldValue: current.agentAddress || "None (Revoked)",
      newValue: proposed.agentAddress || "Revoked",
      isSafer: isRevoke,
      reason: isRevoke
        ? "Revoking agent trading permissions is immediately safer (Safer)"
        : "Granting or replacing the agent key delegates trading rights (Riskier - Timelock Required)",
    });
  }

  const hasRiskier = diffs.some((d) => !d.isSafer);
  const isAllSafer = diffs.length > 0 && !hasRiskier;

  return {
    isAllSafer,
    isSaferOverall: isAllSafer,
    hasRiskier,
    diffs,
    executionMode: hasRiskier ? "QUEUED_TIMELOCK" : "INSTANT",
    summary:
      diffs.length === 0
        ? "No changes detected."
        : hasRiskier
        ? "Includes loosening / riskier changes. By Risk Kernel invariant, this change must be queued in a timelock delay before activation, allowing cancellation anytime."
        : "All proposed modifications strictly tighten safety limits. These apply immediately upon your transaction confirmation.",
  };
}
