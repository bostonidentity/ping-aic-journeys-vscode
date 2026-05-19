import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import { MessageNode, type PaicNode } from "@/views/nodes/base";
import { CategoryHeaderNode } from "@/views/nodes/category-header";
import { EsvNode } from "@/views/nodes/esv";
import { groupAndSort, kindOf } from "@/views/nodes/grouping";
import { InnerJourneyNode } from "@/views/nodes/inner-journey";
import { ScriptNode } from "@/views/nodes/script";
import { ThemeNode } from "@/views/nodes/theme";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

const HOST = "h.example.com";
const REALM = "alpha";

function script(id: string, name: string): ScriptNode {
  return new ScriptNode(
    HOST,
    REALM,
    id,
    makeFakeCache(makeFakePaicClient({})),
    makeFakeLogger(),
    undefined,
    [],
    { id, name, body: "" } as never,
  );
}

function inner(id: string): InnerJourneyNode {
  return new InnerJourneyNode(
    HOST,
    REALM,
    id,
    makeFakeCache(makeFakePaicClient({})),
    makeFakeLogger(),
    [],
  );
}

function theme(id: string, name: string): ThemeNode {
  return new ThemeNode(
    HOST,
    REALM,
    id,
    makeFakeCache(makeFakePaicClient({})),
    makeFakeLogger(),
    undefined,
    { id, name } as never,
  );
}

function esv(name: string, kind?: "variable" | "secret" | "missing"): EsvNode {
  return new EsvNode(HOST, REALM, name, undefined, kind);
}

describe("kindOf", () => {
  it("classifies known node kinds", () => {
    expect(kindOf(script("a", "A"))).toBe("script");
    expect(kindOf(inner("I"))).toBe("innerJourney");
    expect(kindOf(theme("t", "T"))).toBe("theme");
    expect(kindOf(esv("e"))).toBe("esv");
  });

  it("returns null for unknown nodes (MessageNode etc.)", () => {
    expect(kindOf(new MessageNode("hi", "info"))).toBeNull();
  });
});

describe("groupAndSort", () => {
  it("returns an empty array for empty input", () => {
    expect(groupAndSort([])).toEqual([]);
  });

  it("inserts a header even when only one kind is present, with the bucket count", () => {
    const out = groupAndSort([script("s1", "Bravo"), script("s2", "Alpha")]);
    const headers = out.filter((n) => n instanceof CategoryHeaderNode).map((n) => n.label);
    expect(headers).toEqual(["── Scripts (2) ──"]);
    // Header → ScriptAlpha → ScriptBravo
    expect(out).toHaveLength(3);
    expect((out[1] as ScriptNode).scriptId).toBe("s2");
    expect((out[2] as ScriptNode).scriptId).toBe("s1");
  });

  it("inserts headers in priority order when 2+ kinds are present, each with its bucket count", () => {
    // 1 theme + 2 scripts + 1 inner-journey → emit inner header(1), inner,
    // script header(2), scripts alphabetical, theme header(1), theme.
    const out = groupAndSort([
      theme("t", "ThemeX"),
      script("s1", "Bravo"),
      inner("InnerX"),
      script("s2", "Alpha"),
    ]);
    const headers = out.filter((n) => n instanceof CategoryHeaderNode).map((n) => n.label);
    expect(headers).toEqual(["── Inner Journeys (1) ──", "── Scripts (2) ──", "── Themes (1) ──"]);
    // Header → InnerJourney → Header → ScriptAlpha → ScriptBravo → Header → Theme
    expect(out).toHaveLength(7);
    expect(out[1]).toBeInstanceOf(InnerJourneyNode);
    expect((out[3] as ScriptNode).scriptId).toBe("s2");
    expect((out[4] as ScriptNode).scriptId).toBe("s1");
    expect(out[6]).toBeInstanceOf(ThemeNode);
  });

  it("sorts case-insensitively within a kind (locale-aware)", () => {
    const out = groupAndSort([script("s1", "abe"), script("s2", "ABD"), script("s3", "abc")]);
    // First row is the always-on header, then alphabetized scripts.
    expect(out[0]).toBeInstanceOf(CategoryHeaderNode);
    expect((out[1] as ScriptNode).scriptId).toBe("s3"); // abc
    expect((out[2] as ScriptNode).scriptId).toBe("s2"); // ABD
    expect((out[3] as ScriptNode).scriptId).toBe("s1"); // abe
  });

  it("splits ESVs into Variables / Secrets / Missing buckets based on `EsvNode.kind` (D22)", () => {
    const out = groupAndSort([
      esv("esv.gone", "missing"),
      esv("esv.b", "variable"),
      esv("esv.sec", "secret"),
      esv("esv.a", "variable"),
    ]);
    const headers = out.filter((n) => n instanceof CategoryHeaderNode).map((n) => n.label);
    expect(headers).toEqual([
      "── ESV Variables (2) ──",
      "── ESV Secrets (1) ──",
      "── ESVs (missing) (1) ──",
    ]);
    // Each header is followed by its node(s) in alphabetical order.
    expect((out[1] as EsvNode).name).toBe("esv.a");
    expect((out[2] as EsvNode).name).toBe("esv.b");
    expect((out[4] as EsvNode).name).toBe("esv.sec");
    expect((out[6] as EsvNode).name).toBe("esv.gone");
  });

  it("ESVs without a `kind` fall back to the unclassified 'ESVs' group", () => {
    const out = groupAndSort([esv("esv.a"), esv("esv.b")]); // no kind argument
    expect((out[0] as CategoryHeaderNode).label).toBe("── ESVs (2) ──");
  });

  it("appends unknown-kind nodes (e.g. MessageNode for cycles) at the end", () => {
    const msg = new MessageNode("[cycle: X]", "cycle");
    const out: PaicNode[] = groupAndSort([msg, script("s1", "AScript"), inner("InnerA")]);
    // Last element should be the MessageNode; real nodes come first with
    // headers because we have 2 known kinds.
    expect(out[out.length - 1]).toBe(msg);
    expect(out[0]).toBeInstanceOf(CategoryHeaderNode);
  });
});
