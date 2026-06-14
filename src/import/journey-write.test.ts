import { describe, expect, it, vi } from "vitest";
import { PaicError } from "../paic/errors";
import { type JourneyWriteClient, type JourneyWriteUnit, writeJourneyUnit } from "./journey-write";

function client(over: Record<string, unknown> = {}): JourneyWriteClient {
  return {
    writeNode: vi.fn(() => Promise.resolve("created" as const)),
    writeTree: vi.fn(() => Promise.resolve("created" as const)),
    ...over,
  } as unknown as JourneyWriteClient;
}

const node = (type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  _id: "n",
  _type: { _id: type },
  ...extra,
});

const unit = (raw: Record<string, unknown>, id = "Login"): JourneyWriteUnit => ({
  id,
  displayName: id,
  raw,
});

const NO_REMAP = new Map<string, string>();

const invalidAttr400 = (validAttributes: string[]) =>
  new PaicError("Invalid attribute specified.", {
    status: 400,
    description: "Invalid attribute specified.",
    detail: { validAttributes },
  });

describe("writeJourneyUnit", () => {
  it("writes every node then the tree, returning the tree outcome", async () => {
    const writeNode = vi.fn(() => Promise.resolve("created" as const));
    const writeTree = vi.fn(() => Promise.resolve("overwritten" as const));
    const r = await writeJourneyUnit(
      client({ writeNode, writeTree }),
      "alpha",
      unit({
        tree: { entryNodeId: "a" },
        nodes: { a: node("PageNode"), b: node("ScriptedDecisionNode") },
        innerNodes: { c: node("UsernameCollectorNode") },
      }),
      NO_REMAP,
    );
    expect(writeNode).toHaveBeenCalledTimes(3);
    expect(writeTree).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ kind: "journey", id: "Login", status: "overwritten" });
  });

  it("remaps a node's script ref to the target UUID before writing", async () => {
    const writeNode = vi.fn(() => Promise.resolve("created" as const));
    await writeJourneyUnit(
      client({ writeNode }),
      "alpha",
      unit({ tree: {}, nodes: { a: node("ScriptedDecisionNode", { script: "b1" }) } }),
      new Map([["b1", "t1"]]),
    );
    const [realm, type, id, body] = writeNode.mock.calls[0] as unknown as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect([realm, type, id]).toEqual(["alpha", "ScriptedDecisionNode", "a"]);
    expect(body.script).toBe("t1");
  });

  it("PD-12: a surviving source UUID after remap throws → unit failed, tree not written", async () => {
    const writeTree = vi.fn(() => Promise.resolve("created" as const));
    // Chained remap: remapNodeScript rewrites b1→b2, but b2 is itself a key, so
    // the assertion sees a survivor. (buildScriptRemap can't produce this; the
    // guard must still catch it.)
    const r = await writeJourneyUnit(
      client({ writeTree }),
      "alpha",
      unit({ tree: {}, nodes: { a: node("ScriptedDecisionNode", { script: "b1" }) } }),
      new Map([
        ["b1", "b2"],
        ["b2", "t2"],
      ]),
    );
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/b2/);
    expect(writeTree).not.toHaveBeenCalled();
  });

  it("PD-15: a failed node skips the tree write and fails the unit", async () => {
    const writeNode = vi
      .fn()
      .mockResolvedValueOnce("created")
      .mockRejectedValueOnce(new Error("boom"));
    const writeTree = vi.fn(() => Promise.resolve("created" as const));
    const r = await writeJourneyUnit(
      client({ writeNode, writeTree }),
      "alpha",
      unit({ tree: {}, nodes: { a: node("PageNode"), b: node("ScriptedDecisionNode") } }),
      NO_REMAP,
    );
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/node "b".*boom.*tree not written/);
    expect(writeTree).not.toHaveBeenCalled();
  });

  it("G2: strips invalid attributes and retries once on the AM 400", async () => {
    const writeNode = vi
      .fn()
      .mockRejectedValueOnce(invalidAttr400(["_id", "_type", "script"]))
      .mockResolvedValue("created");
    const r = await writeJourneyUnit(
      client({ writeNode }),
      "alpha",
      unit({
        tree: {},
        nodes: { a: node("ScriptedDecisionNode", { script: "s", stale: "drop-me" }) },
      }),
      NO_REMAP,
    );
    expect(writeNode).toHaveBeenCalledTimes(2);
    const retryBody = writeNode.mock.calls[1][3] as Record<string, unknown>;
    expect(retryBody.script).toBe("s");
    expect(retryBody._id).toBe("n");
    expect(retryBody.stale).toBeUndefined(); // not in validAttributes → stripped
    expect(r.status).toBe("created");
  });

  it("G2 negative: a non-G2 400 is not retried → unit failed", async () => {
    const writeNode = vi.fn(() =>
      Promise.reject(new PaicError("nope", { status: 400, description: "something else" })),
    );
    const r = await writeJourneyUnit(
      client({ writeNode }),
      "alpha",
      unit({ tree: {}, nodes: { a: node("PageNode") } }),
      NO_REMAP,
    );
    expect(writeNode).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("failed");
  });

  it("a node missing _type._id fails the unit before any write", async () => {
    const writeNode = vi.fn(() => Promise.resolve("created" as const));
    const writeTree = vi.fn(() => Promise.resolve("created" as const));
    const r = await writeJourneyUnit(
      client({ writeNode, writeTree }),
      "alpha",
      unit({ tree: {}, nodes: { a: { _id: "a" } } }),
      NO_REMAP,
    );
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/missing _type\._id/);
    expect(writeNode).not.toHaveBeenCalled();
    expect(writeTree).not.toHaveBeenCalled();
  });
});
