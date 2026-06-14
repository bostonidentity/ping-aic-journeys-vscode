import { describe, expect, it, vi } from "vitest";
import type { WritePlanItem } from "./execute";
import {
  type JourneyExecuteClient,
  type JourneyImportPlan,
  runJourneyExecute,
} from "./journey-execute";
import type { JourneyWriteUnit } from "./journey-write";

/** Fake client; `order` records leaf/node/tree writes in call order. Node/tree
 * ids in `rejectNode`/`rejectTree` reject; `rejectLeaf` fails the theme write. */
function makeClient(
  opts: {
    order?: string[];
    rejectNode?: Set<string>;
    rejectTree?: Set<string>;
    rejectLeaf?: boolean;
  } = {},
): JourneyExecuteClient {
  const { order = [], rejectNode = new Set(), rejectTree = new Set(), rejectLeaf = false } = opts;
  const ok = () => Promise.resolve("created" as const);
  return {
    writeTheme: vi.fn(() => {
      order.push("leaf");
      return rejectLeaf ? Promise.reject(new Error("leaf boom")) : ok();
    }),
    writeEmailTemplate: vi.fn(ok),
    writeSocialIdp: vi.fn(ok),
    writeEsvVariable: vi.fn(ok),
    writeEsvSecret: vi.fn(ok),
    writeScript: vi.fn(ok),
    writeNode: vi.fn((_realm: string, _type: string, id: string) => {
      order.push(`node:${id}`);
      return rejectNode.has(id) ? Promise.reject(new Error("node boom")) : ok();
    }),
    writeTree: vi.fn((_realm: string, id: string) => {
      order.push(`tree:${id}`);
      return rejectTree.has(id) ? Promise.reject(new Error("tree boom")) : ok();
    }),
  } as unknown as JourneyExecuteClient;
}

/** A journey unit with one PageNode (`<id>_n`) plus an InnerTreeEvaluatorNode per
 * referenced inner tree. */
const jUnit = (id: string, refs: string[] = []): JourneyWriteUnit => {
  const nodes: Record<string, unknown> = {
    [`${id}_n`]: { _id: `${id}_n`, _type: { _id: "PageNode" } },
  };
  refs.forEach((r, i) => {
    nodes[`${id}_e${i}`] = {
      _id: `${id}_e${i}`,
      _type: { _id: "InnerTreeEvaluatorNode" },
      tree: r,
    };
  });
  return { id, displayName: id, raw: { tree: { _id: id }, nodes, innerNodes: {} } };
};

const themeLeaf: WritePlanItem = {
  component: { kind: "theme", id: "t1", displayName: "t1", raw: { _id: "t1" } },
  verdict: "new",
};

const plan = (over: Partial<JourneyImportPlan>): JourneyImportPlan => ({
  leaves: [],
  journeys: [],
  scriptRemap: new Map(),
  ...over,
});

const treeOrder = (order: string[]) =>
  order.filter((o) => o.startsWith("tree:")).map((o) => o.slice("tree:".length));

describe("runJourneyExecute", () => {
  it("writes all leaves before any journey, returning [leaves, journeys]", async () => {
    const order: string[] = [];
    const r = await runJourneyExecute(makeClient({ order }), "alpha", {
      leaves: [themeLeaf],
      journeys: [jUnit("A")],
      scriptRemap: new Map(),
    });
    expect(order[0]).toBe("leaf");
    expect(order).toContain("tree:A");
    expect(order.indexOf("leaf")).toBeLessThan(order.indexOf("tree:A"));
    expect(r.map((x) => x.kind)).toEqual(["theme", "journey"]);
    expect(r[1]).toMatchObject({ id: "A", status: "created" });
  });

  it("orders an inner journey before the subject that references it (topo)", async () => {
    const order: string[] = [];
    // input order subject-first; topo must still write MFA's tree before Login's.
    await runJourneyExecute(
      makeClient({ order }),
      "alpha",
      plan({ journeys: [jUnit("Login", ["MFA"]), jUnit("MFA")] }),
    );
    expect(treeOrder(order)).toEqual(["MFA", "Login"]);
  });

  it("orders the deepest inner first when journeys nest", async () => {
    const order: string[] = [];
    await runJourneyExecute(
      makeClient({ order }),
      "alpha",
      plan({
        journeys: [jUnit("Login", ["MFA"]), jUnit("MFA", ["DeviceCheck"]), jUnit("DeviceCheck")],
      }),
    );
    expect(treeOrder(order)).toEqual(["DeviceCheck", "MFA", "Login"]);
  });

  it("skips a dependent when its prerequisite journey fails (PD-15)", async () => {
    const order: string[] = [];
    const r = await runJourneyExecute(
      makeClient({ order, rejectNode: new Set(["MFA_n"]) }),
      "alpha",
      plan({ journeys: [jUnit("Login", ["MFA"]), jUnit("MFA")] }),
    );
    const mfa = r.find((x) => x.id === "MFA");
    const login = r.find((x) => x.id === "Login");
    expect(mfa?.status).toBe("failed");
    expect(login?.status).toBe("skipped");
    expect(login?.message).toBe('prerequisite "MFA" failed');
    expect(treeOrder(order)).not.toContain("Login"); // never wired
  });

  it("propagates the skip transitively through a chain", async () => {
    const r = await runJourneyExecute(
      makeClient({ rejectNode: new Set(["DeviceCheck_n"]) }),
      "alpha",
      plan({
        journeys: [jUnit("Login", ["MFA"]), jUnit("MFA", ["DeviceCheck"]), jUnit("DeviceCheck")],
      }),
    );
    expect(r.find((x) => x.id === "DeviceCheck")?.status).toBe("failed");
    expect(r.find((x) => x.id === "MFA")?.status).toBe("skipped");
    expect(r.find((x) => x.id === "Login")?.status).toBe("skipped");
  });

  it("a failed leaf does not block an independent journey", async () => {
    const r = await runJourneyExecute(makeClient({ rejectLeaf: true }), "alpha", {
      leaves: [themeLeaf],
      journeys: [jUnit("A")],
      scriptRemap: new Map(),
    });
    expect(r.find((x) => x.kind === "theme")?.status).toBe("failed");
    expect(r.find((x) => x.id === "A")?.status).toBe("created");
  });

  it("returns [] for an empty plan", async () => {
    expect(await runJourneyExecute(makeClient(), "alpha", plan({}))).toEqual([]);
  });

  it("invokes onResult for every leaf + journey unit, incl. a skipped dependent (PD-16)", async () => {
    const order: string[] = [];
    await runJourneyExecute(
      makeClient({ rejectNode: new Set(["MFA_n"]) }),
      "alpha",
      {
        leaves: [themeLeaf],
        journeys: [jUnit("Login", ["MFA"]), jUnit("MFA")],
        scriptRemap: new Map(),
      },
      (r) => order.push(`${r.kind}:${r.id}:${r.status}`),
    );
    // leaf first, then MFA (node fails), then Login (skipped — depends on MFA).
    expect(order).toEqual(["theme:t1:created", "journey:MFA:failed", "journey:Login:skipped"]);
  });
});
