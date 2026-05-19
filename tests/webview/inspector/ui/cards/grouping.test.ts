import { describe, expect, it } from "vitest";
import type { ResolvedEdge, ResolvedNode } from "@/domain/resolved-graph";
import { displayKindOf, groupAndSort } from "@/webview/inspector/ui/cards/grouping";

function n(
  kind: ResolvedNode["kind"],
  id: string,
  displayName: string,
  extras: Partial<ResolvedNode> = {},
): ResolvedNode {
  return { key: `${kind}:${id}`, kind, id, displayName, depth: 1, ...extras };
}

function edgeMap(nodes: readonly ResolvedNode[]): Map<string, ResolvedEdge> {
  return new Map(nodes.map((nd) => [nd.key, { fromKey: "root", toKey: nd.key, via: "x" }]));
}

describe("grouping/displayKindOf", () => {
  it("maps a journey-kind node to innerJourney (every visible journey row in the resolved view is reached transitively)", () => {
    expect(displayKindOf(n("journey", "A", "A"))).toBe("innerJourney");
  });

  it("maps a regular script to 'script' and a library script to 'libraryScript'", () => {
    expect(displayKindOf(n("script", "s", "s"))).toBe("script");
    expect(displayKindOf(n("script", "s", "s", { isLibrary: true }))).toBe("libraryScript");
  });

  it("passes through leaf kinds unchanged", () => {
    expect(displayKindOf(n("esv", "esv.x", "esv.x"))).toBe("esv");
    expect(displayKindOf(n("theme", "t", "t"))).toBe("theme");
    expect(displayKindOf(n("emailTemplate", "et", "et"))).toBe("emailTemplate");
    expect(displayKindOf(n("socialIdp", "google", "google"))).toBe("socialIdp");
  });
});

describe("groupAndSort", () => {
  it("sorts within-kind alphabetically (case-insensitive) and emits dividers when ≥2 kinds present", () => {
    const nodes = [
      n("script", "s2", "bravo"),
      n("script", "s1", "Alpha"),
      n("esv", "esv.x.y", "esv.x.y"),
    ];
    const rows = groupAndSort(nodes, edgeMap(nodes));
    // Expected order: divider Scripts, Alpha, bravo, divider ESVs, esv.x.y
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ row: "divider", label: "Scripts" });
    expect(rows[1]).toMatchObject({ row: "node", node: { displayName: "Alpha" } });
    expect(rows[2]).toMatchObject({ row: "node", node: { displayName: "bravo" } });
    expect(rows[3]).toMatchObject({ row: "divider", label: "ESVs" });
    expect(rows[4]).toMatchObject({ row: "node", node: { displayName: "esv.x.y" } });
  });

  it("subdivides scripts and library scripts into separate kind groups", () => {
    const nodes = [
      n("script", "lib1", "helpers", { isLibrary: true }),
      n("script", "reg1", "validator"),
    ];
    const rows = groupAndSort(nodes, edgeMap(nodes));
    // Order: divider Scripts, validator, divider Library scripts, helpers
    expect(rows).toMatchObject([
      { row: "divider", label: "Scripts" },
      { row: "node", node: { displayName: "validator" } },
      { row: "divider", label: "Library scripts" },
      { row: "node", node: { displayName: "helpers" } },
    ]);
  });

  it("always emits a divider for the kind, even when only one kind is present", () => {
    const nodes = [n("script", "s2", "bravo"), n("script", "s1", "Alpha")];
    const rows = groupAndSort(nodes, edgeMap(nodes));
    // 1 divider + 2 nodes
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ row: "divider", label: "Scripts", count: 2 });
    expect(rows[1]).toMatchObject({ row: "node", node: { displayName: "Alpha" } });
    expect(rows[2]).toMatchObject({ row: "node", node: { displayName: "bravo" } });
  });

  it("splits ESVs into Variables / Secrets / Missing buckets based on `esvKind`", () => {
    const nodes = [
      n("esv", "esv.b", "esv.b", { esvKind: "variable" }),
      n("esv", "esv.a", "esv.a", { esvKind: "variable" }),
      n("esv", "esv.sec", "esv.sec", { esvKind: "secret" }),
      n("esv", "esv.gone", "esv.gone", { esvKind: "missing" }),
    ];
    const rows = groupAndSort(nodes, edgeMap(nodes));
    expect(rows).toMatchObject([
      { row: "divider", label: "ESV Variables", count: 2 },
      { row: "node", node: { displayName: "esv.a" } },
      { row: "node", node: { displayName: "esv.b" } },
      { row: "divider", label: "ESV Secrets", count: 1 },
      { row: "node", node: { displayName: "esv.sec" } },
      { row: "divider", label: "ESVs (missing)", count: 1 },
      { row: "node", node: { displayName: "esv.gone" } },
    ]);
  });

  it("falls back to a plain 'ESVs' bucket when `esvKind` is absent (older fixtures / fetch failed)", () => {
    const nodes = [
      n("esv", "esv.a", "esv.a"), // no esvKind
      n("esv", "esv.b", "esv.b"),
    ];
    const rows = groupAndSort(nodes, edgeMap(nodes));
    expect(rows[0]).toMatchObject({ row: "divider", label: "ESVs", count: 2 });
  });

  it("respects the canonical section order (innerJourney → script → libraryScript → theme → email → socialIdp → esv)", () => {
    const nodes = [
      n("esv", "e", "e"),
      n("socialIdp", "google", "google"),
      n("emailTemplate", "et", "et"),
      n("theme", "t", "t"),
      n("script", "s-lib", "lib", { isLibrary: true }),
      n("script", "s-reg", "reg"),
      n("journey", "j", "j"),
    ];
    const rows = groupAndSort(nodes, edgeMap(nodes)).filter((r) => r.row === "divider");
    expect(rows.map((r) => (r.row === "divider" ? r.label : ""))).toEqual([
      "Inner journeys",
      "Scripts",
      "Library scripts",
      "Themes",
      "Email templates",
      "Social IdPs",
      "ESVs",
    ]);
  });
});
