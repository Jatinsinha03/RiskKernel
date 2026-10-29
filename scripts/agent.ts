import { AgentWorker } from "../src/lib/agent/worker";
import { StateService } from "../src/lib/agent/state";
import prisma from "../src/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const isOnce = args.includes("--once");
  const isSimulate = args.includes("--simulate");
  const isStatus = args.includes("--status");
  const isKill = args.includes("--kill");
  const isResume = args.includes("--resume");

  const state = new StateService();

  if (isStatus) {
    const heartbeat = await prisma.workerHeartbeat.findUnique({
      where: { workerId: "primary" },
    });
    const killFlag = await prisma.workerFlag.findUnique({
      where: { key: "GLOBAL_KILL_SWITCH" },
    });

    console.log("=== Risk Kernel Agent Worker Status ===");
    console.log(`Worker Status: ${heartbeat?.status || "offline"}`);
    console.log(`Global Kill Switch: ${killFlag?.value === "true" ? "ACTIVE (TRIPPED)" : "OFF (NORMAL)"}`);
    console.log(`Last Loop At: ${heartbeat?.lastLoopAt ? new Date(heartbeat.lastLoopAt).toISOString() : "Never"}`);
    console.log(`Latest Block: ${heartbeat?.lastBlock || 0}`);
    console.log(`Agent HSK Balance: ${heartbeat?.agentHskBalance || "0"} HSK`);
    console.log(`Active Vaults: ${heartbeat?.activeVaultsCount || 0}`);
    console.log(`Candidates Evaluated: ${heartbeat?.candidatesCount || 0}`);
    console.log(`Simulations Run: ${heartbeat?.simulationsCount || 0}`);
    console.log(`Sends Executed: ${heartbeat?.sendsCount || 0}`);
    if (heartbeat?.lastError) {
      console.log(`Last Error: ${heartbeat.lastError}`);
    }
    process.exit(0);
  }

  if (isKill) {
    await state.setKillSwitch(true);
    console.log("✅ Global kill switch has been ACTIVATED. Agent trading halted.");
    process.exit(0);
  }

  if (isResume) {
    await state.setKillSwitch(false);
    console.log("✅ Global kill switch has been DEACTIVATED. Agent trading resumed.");
    process.exit(0);
  }

  const addTokenIdx = args.indexOf("--add-token");
  if (addTokenIdx !== -1 && args[addTokenIdx + 1]) {
    const tokenAddr = args[addTokenIdx + 1];
    const { CatalogService } = await import("../src/lib/agent/catalog");
    const { ChainService } = await import("../src/lib/agent/chain");
    const { loadAgentConfig } = await import("../src/lib/agent/config");
    
    const cfg = loadAgentConfig();
    const chain = new ChainService(cfg);
    const catalog = new CatalogService(chain, cfg);

    console.log(`[AgentWorker CLI] Registering token address: ${tokenAddr}...`);
    const registered = await catalog.registerToken(tokenAddr);
    if (registered) {
      console.log(`✅ Successfully registered token: ${registered.symbol} (${registered.address}) with ${registered.decimals} decimals`);
      console.log(`[AgentWorker CLI] Discovered liquidity pools have been added to the catalog.`);
    } else {
      console.error(`❌ Failed to register token ${tokenAddr}. Check that the address is an ERC-20 contract on HashKey Chain.`);
    }
    process.exit(0);
  }

  const worker = new AgentWorker(
    isSimulate ? { simulateOnly: true } : undefined
  );

  if (isOnce) {
    console.log("[AgentWorker CLI] Running single tick...");
    await worker.tick();
    console.log("[AgentWorker CLI] Single tick complete.");
    process.exit(0);
  }

  // Continuous run
  await worker.start();

  const shutdown = async () => {
    console.log("\n[AgentWorker CLI] Received termination signal. Shutting down...");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[AgentWorker CLI] Fatal error:", err);
  process.exit(1);
});
