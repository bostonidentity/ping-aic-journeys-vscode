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

function esv(name: string): EsvNode {
  return new EsvNode(HOST, REALM, name);
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

  it("does NOT insert a header when only one kind is present (single-kind rule)", () => {
    const out = groupAndSort([script("s1", "Bravo"), script("s2", "Alpha")]);
    expect(out.some((n) => n instanceof CategoryHeaderNode)).toBe(false);
    // Sorted alphabetically by name: "Alpha" before "Bravo".
    expect((out[0] as ScriptNode).scriptId).toBe("s2");
    expect((out[1] as ScriptNode).scriptId).toBe("s1");
  });

  it("inserts headers in priority order when 2+ kinds are present", () => {
    // 1 theme + 2 scripts + 1 inner-journey → emit inner header, inner,
    // script header, scripts alphabetical, theme header, theme.
    const out = groupAndSort([
      theme("t", "ThemeX"),
      script("s1", "Bravo"),
      inner("InnerX"),
      script("s2", "Alpha"),
    ]);
    const headers = out.filter((n) => n instanceof CategoryHeaderNode).map((n) => n.label);
    expect(headers).toEqual(["── Inner Journeys ──", "── Scripts ──", "── Themes ──"]);
    // Header → InnerJourney → Header → ScriptAlpha → ScriptBravo → Header → Theme
    expect(out).toHaveLength(7);
    expect(out[1]).toBeInstanceOf(InnerJourneyNode);
    expect((out[3] as ScriptNode).scriptId).toBe("s2");
    expect((out[4] as ScriptNode).scriptId).toBe("s1");
    expect(out[6]).toBeInstanceOf(ThemeNode);
  });

  it("sorts case-insensitively within a kind (locale-aware)", () => {
    const out = groupAndSort([script("s1", "abe"), script("s2", "ABD"), script("s3", "abc")]);
    expect((out[0] as ScriptNode).scriptId).toBe("s3"); // abc
    expect((out[1] as ScriptNode).scriptId).toBe("s2"); // ABD
    expect((out[2] as ScriptNode).scriptId).toBe("s1"); // abe
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
