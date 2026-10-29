import prisma from "@/lib/prisma";
import { AgentConfig, loadAgentConfig } from "./config";
import { ChainService, StepStruct } from "./chain";
import { StateService } from "./state";
import { RegistryService, ActiveVaultContext } from "./registry";
import { CatalogService } from "./catalog";
import { ScannerService, CandidateCycle } from "./scanner";
import { SimulatorService } from "./simulator";
import { SizerService } from "./sizer";
import { EconomicsService } from "./economics";
import { AiService, EvaluatedOpportunity } from "./ai";
import { ApprovalService } from "./approvals";
import { ExecutorService } from "./executor";
import { ReconcilerService } from "./reconciler";

export class AgentWorker {
  private config: AgentConfig;
  private chain: ChainService;
  private state: StateService;
  private registry: RegistryService;
  private catalog: CatalogService;
  private scanner: ScannerService;
  private simulator: SimulatorService;
  private sizer: SizerService;
  private economics: EconomicsService;
  private ai: AiService;
  private approvals: ApprovalService;
  private executor: ExecutorService;
  private reconciler: ReconcilerService;

  private isRunning = false;
  private isTickInProgress = false;

  constructor(customConfig?: Partial<AgentConfig>) {
    this.config = { ...loadAgentConfig(), ...(customConfig || {}) };
    this.chain = new ChainService(this.config);
    this.state = new StateService();
    this.registry = new RegistryService(this.chain, this.config);
    this.catalog = new CatalogService(this.chain, this.config);
    this.scanner = new ScannerService(this.config);
    this.simulator = new SimulatorService(this.chain);
    this.sizer = new SizerService(this.config);
    this.economics = new EconomicsService(this.chain, this.config);
    this.ai = new AiService(this.config);
    this.approvals = new ApprovalService(this.chain, this.simulator);
    this.executor = new ExecutorService(this.chain, this.config);
    this.reconciler = new ReconcilerService(this.chain);
  }

  /**
   * Initializes services, advisory lock, and startup reconciliation
   */
  public async start(): Promise<void> {
    console.log(`[AgentWorker] Initializing Phase 2 Agent Worker (Chain: ${this.config.chainId}, RPC: ${this.config.rpcUrl})`);
    console.log(`[AgentWorker] Mode: ${this.config.simulateOnly ? "SIMULATE_ONLY" : "LIVE_EXECUTION"} | AI Mode: ${this.config.aiMode}`);
    if (this.config.agentAddress) {
      console.log(`[AgentWorker] Signer Address: ${this.config.agentAddress}`);
    }

    const hasLock = await this.state.acquireInstanceLock();
    if (!hasLock) {
      console.warn("[AgentWorker] Another worker instance holds the advisory lock. Standing by.");
    }

    await this.reconciler.reconcilePendingAttempts();
    await this.catalog.ensureCatalog();

    this.isRunning = true;
    console.log(`[AgentWorker] Worker started. Polling every ${this.config.pollIntervalMs}ms.`);

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        await this.tick();
      } catch (err) {
        console.error("[AgentWorker] Error in tick execution:", err);
      }
      if (this.isRunning) {
        setTimeout(loop, this.config.pollIntervalMs);
      }
    };

    loop();
  }

  /**
   * Stop the loop and release resources
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    await this.state.releaseInstanceLock();
    await this.state.updateHeartbeat({
      lastBlock: 0,
      agentHskBalance: "0",
      status: "offline",
      activeVaultsCount: 0,
      candidatesCount: 0,
      simulationsCount: 0,
      sendsCount: 0,
    });
    console.log("[AgentWorker] Worker stopped gracefully.");
  }

  /**
   * Execute a single tick over all active vaults
   */
  public async tick(): Promise<void> {
    if (this.isTickInProgress) return;
    this.isTickInProgress = true;

    let latestBlock = 0;
    let agentHsk = "0.0";
    let candidatesFound = 0;
    let simulationsRun = 0;
    let sendsExecuted = 0;
    let lastError: string | null = null;

    try {
      // 1. Safety controls: Kill switch and agent gas check
      const killSwitch = await this.state.isKillSwitchActive();
      if (killSwitch) {
        console.log("[AgentWorker] Global kill switch is ACTIVE. Skipping trading tick.");
        await this.state.updateHeartbeat({
          lastBlock: 0,
          agentHskBalance: "0",
          status: "idle",
          activeVaultsCount: 0,
          candidatesCount: 0,
          simulationsCount: 0,
          sendsCount: 0,
          lastError: "Global kill switch active",
        });
        return;
      }

      [latestBlock, agentHsk] = await Promise.all([
        this.chain.provider.getBlockNumber().catch(() => 0),
        this.chain.getAgentHskBalance(),
      ]);

      if (parseFloat(agentHsk) < this.config.minAgentHsk && !this.config.simulateOnly) {
        console.warn(`[AgentWorker] Agent HSK balance (${agentHsk}) is below safety threshold (${this.config.minAgentHsk}). Halting trades.`);
        await this.state.updateHeartbeat({
          lastBlock: latestBlock,
          agentHskBalance: agentHsk,
          status: "error",
          activeVaultsCount: 0,
          candidatesCount: 0,
          simulationsCount: 0,
          sendsCount: 0,
          lastError: "Low agent HSK gas balance",
        });
        return;
      }

      // 2. Refresh token & pool catalog if due
      await this.catalog.ensureCatalog();
      const activePools = await this.catalog.getActivePools();

      // 3. Load active eligible vaults
      const eligibleVaults = await this.registry.getEligibleVaults();

      for (const vault of eligibleVaults) {
        // 4. Generate candidate cycles for vault
        const candidates = this.scanner.generateCandidates(vault, activePools);
        candidatesFound += candidates.length;

        const candidateSizes = this.sizer.getCandidateSizes(vault);
        if (candidateSizes.length === 0 || candidates.length === 0) continue;

        const viableOpportunities: EvaluatedOpportunity[] = [];

        // 5. Simulate each candidate across sizes
        for (const cand of candidates) {
          for (const size of candidateSizes) {
            simulationsRun++;
            const sim = await this.simulator.simulateCycle(vault, cand.steps, size);

            if (sim.requiresApproval) {
              // Above threshold: Log opportunity & request human approval
              const opp = await prisma.opportunity.create({
                data: {
                  vaultAddress: vault.address,
                  route: cand.steps.map((s) => ({
                    tokenIn: s.tokenIn,
                    tokenOut: s.tokenOut,
                    fee: s.fee,
                  })),
                  cycleHash: await this.approvals.hashCycle(vault.address, cand.steps),
                  tradeAmount: (Number(size) / 1e6).toFixed(2),
                  estimatedProfit: "0.05",
                  minProfit: "0.03",
                  status: "awaiting_approval",
                  reason: "Exceeds mandate approvalThreshold - human sign-off required",
                },
              });

              await this.approvals.requestApproval(
                vault,
                opp.id,
                cand.steps,
                size,
                size + BigInt(30000), // minReturn estimate
                0.05
              );
              continue;
            }

            if (!sim.success || sim.grossProfitRaw === BigInt(0)) {
              continue;
            }

            // Economics assessment (gas gate & haircut)
            const econ = await this.economics.assessEconomics(
              size,
              sim.grossProfitRaw,
              sim.estimatedGasUnits
            );

            if (econ.passed) {
              viableOpportunities.push({
                candidate: cand,
                amountIn: size,
                economics: econ,
                requiresApproval: false,
              });
            }
          }
        }

        // 6. Check for previously signed approvals ready to execute
        for (const cand of candidates) {
          for (const size of candidateSizes) {
            const approved = await this.approvals.getApprovedRequestForVault(
              vault,
              cand.steps,
              size,
              size + BigInt(1000)
            );

            if (approved) {
              console.log(`[AgentWorker] Executing verified approved trade for vault ${vault.address}...`);
              const execRes = await this.executor.executeArbitrageTrade(
                vault,
                approved.approvalId,
                cand.steps,
                size,
                BigInt(1000),
                approved.approval
              );

              if (execRes.success) {
                sendsExecuted++;
                await this.approvals.markApprovalUsed(approved.approvalId);
              }
              break;
            }
          }
        }

        // 7. Select & execute best viable opportunity
        if (viableOpportunities.length > 0) {
          const selection = await this.ai.selectOpportunity(viableOpportunities);
          const chosen =
            viableOpportunities.find((c) => c.candidate.id === selection.selectedCandidateId) ||
            viableOpportunities[0];

          // Persist detected opportunity
          const oppRecord = await prisma.opportunity.create({
            data: {
              vaultAddress: vault.address,
              route: chosen.candidate.steps.map((s) => ({
                tokenIn: s.tokenIn,
                tokenOut: s.tokenOut,
                fee: s.fee,
              })),
              cycleHash: await this.approvals.hashCycle(vault.address, chosen.candidate.steps),
              tradeAmount: (Number(chosen.amountIn) / 1e6).toFixed(2),
              estimatedProfit: chosen.economics.netProfitUsdt.toFixed(4),
              netProfitBps: chosen.economics.netProfitBps,
              minProfit: (Number(chosen.economics.onChainMinProfitRaw) / 1e6).toFixed(4),
              gasEstimate: chosen.economics.gasCostUsdt.toFixed(4),
              status: "detected",
              aiScore: selection.score,
              aiReason: selection.reason,
            },
          });

          console.log(`[AgentWorker] Opportunity selected for vault ${vault.address}: ${chosen.candidate.name} (Net Profit: $${chosen.economics.netProfitUsdt.toFixed(4)})`);

          // Execute on-chain
          const execRes = await this.executor.executeArbitrageTrade(
            vault,
            oppRecord.id,
            chosen.candidate.steps,
            chosen.amountIn,
            chosen.economics.onChainMinProfitRaw
          );

          if (execRes.success) {
            sendsExecuted++;
            console.log(`[AgentWorker] Trade successfully confirmed! TxHash: ${execRes.txHash || "simulated"}`);

            // Async trade explanation
            if (execRes.txHash) {
              this.ai
                .explainTrade(
                  chosen.candidate.name,
                  (Number(chosen.amountIn) / 1e6).toFixed(2),
                  chosen.economics.netProfitUsdt.toFixed(4),
                  execRes.txHash
                )
                .then(async (explanation) => {
                  await prisma.opportunity.update({
                    where: { id: oppRecord.id },
                    data: { aiReason: explanation },
                  });
                })
                .catch(() => {});
            }
          }
        }
      }

      // Update heartbeat
      await this.state.updateHeartbeat({
        lastBlock: latestBlock,
        agentHskBalance: agentHsk,
        status: sendsExecuted > 0 ? "running" : "idle",
        activeVaultsCount: eligibleVaults.length,
        candidatesCount: candidatesFound,
        simulationsCount: simulationsRun,
        sendsCount: sendsExecuted,
      });
    } catch (tickErr) {
      lastError = (tickErr as Error).message || "Unknown error";
      console.error("[AgentWorker] Tick encountered error:", tickErr);

      await this.state.updateHeartbeat({
        lastBlock: latestBlock,
        agentHskBalance: agentHsk,
        status: "error",
        activeVaultsCount: 0,
        candidatesCount: candidatesFound,
        simulationsCount: simulationsRun,
        sendsCount: sendsExecuted,
        lastError,
      });
    } finally {
      this.isTickInProgress = false;
    }
  }
}
