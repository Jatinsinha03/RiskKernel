import prisma from "@/lib/prisma";

export class StateService {
  private static ADVISORY_LOCK_ID = 8829103;

  /**
   * Acquire Postgres single-instance advisory lock
   */
  public async acquireInstanceLock(): Promise<boolean> {
    try {
      const res: Array<{ pg_try_advisory_lock: boolean }> = await prisma.$queryRawUnsafe(
        `SELECT pg_try_advisory_lock(${StateService.ADVISORY_LOCK_ID});`
      );
      return res?.[0]?.pg_try_advisory_lock === true;
    } catch (e) {
      console.warn("Could not acquire Postgres advisory lock, continuing with process lock:", e);
      return true;
    }
  }

  /**
   * Release Postgres advisory lock
   */
  public async releaseInstanceLock(): Promise<void> {
    try {
      await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${StateService.ADVISORY_LOCK_ID});`);
    } catch {
      // Ignored on shutdown
    }
  }

  /**
   * Check if global kill switch is tripped
   */
  public async isKillSwitchActive(): Promise<boolean> {
    try {
      const flag = await prisma.workerFlag.findUnique({
        where: { key: "GLOBAL_KILL_SWITCH" },
      });
      return flag?.value === "true";
    } catch {
      return false;
    }
  }

  /**
   * Set kill switch status
   */
  public async setKillSwitch(active: boolean): Promise<void> {
    await prisma.workerFlag.upsert({
      where: { key: "GLOBAL_KILL_SWITCH" },
      update: { value: active ? "true" : "false" },
      create: { key: "GLOBAL_KILL_SWITCH", value: active ? "true" : "false" },
    });
  }

  /**
   * Update heartbeat metrics
   */
  public async updateHeartbeat(data: {
    lastBlock: number;
    agentHskBalance: string;
    status: "running" | "idle" | "waiting_approval" | "offline" | "error";
    activeVaultsCount: number;
    candidatesCount: number;
    simulationsCount: number;
    sendsCount: number;
    lastError?: string | null;
  }): Promise<void> {
    try {
      await prisma.workerHeartbeat.upsert({
        where: { workerId: "primary" },
        update: {
          lastLoopAt: new Date(),
          lastBlock: data.lastBlock,
          agentHskBalance: data.agentHskBalance,
          status: data.status,
          activeVaultsCount: data.activeVaultsCount,
          candidatesCount: data.candidatesCount,
          simulationsCount: data.simulationsCount,
          sendsCount: data.sendsCount,
          lastError: data.lastError || null,
        },
        create: {
          workerId: "primary",
          lastLoopAt: new Date(),
          lastBlock: data.lastBlock,
          agentHskBalance: data.agentHskBalance,
          status: data.status,
          activeVaultsCount: data.activeVaultsCount,
          candidatesCount: data.candidatesCount,
          simulationsCount: data.simulationsCount,
          sendsCount: data.sendsCount,
          lastError: data.lastError || null,
        },
      });
    } catch (err) {
      console.warn("Could not update worker heartbeat:", err);
    }
  }
}
