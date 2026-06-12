import { describe, expect, it, vi } from "vitest";
import { type ApplyClient, runEsvApply } from "./apply";

const instant = (): Promise<void> => Promise.resolve();

/** A fake `ApplyClient` whose `getStartupStatus` serves a queued sequence
 * (an `Error` entry rejects). */
function makeClient(
  statuses: Array<"ready" | "restarting" | Error>,
  applyImpl: () => Promise<void> = () => Promise.resolve(),
) {
  let i = 0;
  const getStartupStatus = vi.fn(() => {
    const s = statuses[Math.min(i, statuses.length - 1)];
    i++;
    return s instanceof Error ? Promise.reject(s) : Promise.resolve(s);
  });
  const applyEsvUpdates = vi.fn(applyImpl);
  return {
    client: { getStartupStatus, applyEsvUpdates } as unknown as ApplyClient,
    getStartupStatus,
    applyEsvUpdates,
  };
}

describe("runEsvApply", () => {
  it("ready → restart → polls until ready (applyEsvUpdates called once)", async () => {
    const { client, applyEsvUpdates } = makeClient(["ready", "restarting", "restarting", "ready"]);
    const r = await runEsvApply(client, { sleep: instant, now: () => 0 });
    expect(r.ok).toBe(true);
    expect(r.finalStatus).toBe("ready");
    expect(applyEsvUpdates).toHaveBeenCalledTimes(1);
  });

  it("already restarting → skips the POST, just polls", async () => {
    const { client, applyEsvUpdates } = makeClient(["restarting", "restarting", "ready"]);
    const r = await runEsvApply(client, { sleep: instant, now: () => 0 });
    expect(r.ok).toBe(true);
    expect(applyEsvUpdates).not.toHaveBeenCalled();
  });

  it("POST throws but the restart started anyway → continues to ready", async () => {
    const { client } = makeClient(["ready", "restarting", "ready"], () =>
      Promise.reject(new Error("502")),
    );
    const r = await runEsvApply(client, { sleep: instant, now: () => 0 });
    expect(r.ok).toBe(true);
  });

  it("POST throws and status is still ready → rethrows", async () => {
    const { client } = makeClient(["ready", "ready"], () => Promise.reject(new Error("boom")));
    await expect(runEsvApply(client, { sleep: instant, now: () => 0 })).rejects.toThrow("boom");
  });

  it("tolerates consecutive poll errors up to maxErrors", async () => {
    const { client } = makeClient(["restarting", new Error("blip"), new Error("blip"), "ready"]);
    const r = await runEsvApply(client, { sleep: instant, now: () => 0, maxErrors: 4 });
    expect(r.ok).toBe(true);
  });

  it("fails after exceeding maxErrors consecutive poll errors", async () => {
    const { client } = makeClient(["restarting", new Error("e"), new Error("e"), new Error("e")]);
    await expect(
      runEsvApply(client, { sleep: instant, now: () => 0, maxErrors: 1 }),
    ).rejects.toThrow("e");
  });

  it("times out → ok:false with finalStatus restarting", async () => {
    let t = 0;
    const { client } = makeClient(["restarting", "restarting", "restarting"]);
    const r = await runEsvApply(client, {
      sleep: instant,
      timeoutMs: 50,
      now: () => (t += 100), // advances past the 50ms budget immediately
    });
    expect(r.ok).toBe(false);
    expect(r.finalStatus).toBe("restarting");
  });

  it("reports progress per poll", async () => {
    const onProgress = vi.fn();
    const { client } = makeClient(["ready", "restarting", "ready"]);
    await runEsvApply(client, { sleep: instant, now: () => 0, onProgress });
    expect(onProgress).toHaveBeenCalled();
  });
});
