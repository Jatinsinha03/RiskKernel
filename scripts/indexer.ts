import { pollAllVaults } from "../src/lib/indexer";

async function main() {
  console.log("Starting Risk Kernel On-Chain Event Indexer for HashKey Chain...");
  
  const pollIntervalMs = 12000; // 12 seconds per poll

  const runLoop = async () => {
    try {
      const results = await pollAllVaults();
      const totalEvents = results.reduce((acc, r) => acc + r.eventsProcessed, 0);
      if (totalEvents > 0) {
        console.log(`[${new Date().toISOString()}] Processed ${totalEvents} new events across ${results.length} vaults.`);
      }
    } catch (err) {
      console.error("Indexer loop error:", err);
    }
  };

  await runLoop();
  setInterval(runLoop, pollIntervalMs);
}

main().catch((err) => {
  console.error("Fatal indexer error:", err);
  process.exit(1);
});
