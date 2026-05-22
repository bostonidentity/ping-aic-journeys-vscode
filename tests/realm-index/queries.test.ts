import { describe, expect, it } from "vitest";
import {
  entityKeyOf,
  type RealmIndexEntity,
  type RealmIndexEntry,
  type ReverseRef,
} from "@/domain/realm-index";
import { findUnused, findUsagePaths, findUsages, searchByName } from "@/realm-index/queries";

const HOST = "openam-tenant.example.forgeblocks.com";
const REALM = "alpha";

function ent(
  kind: RealmIndexEntity["kind"],
  id: string,
  displayName: string,
  extras: Partial<RealmIndexEntity> = {},
): RealmIndexEntity {
  return { key: entityKeyOf(kind, id), kind, id, displayName, ...extras };
}

function buildEntry(): RealmIndexEntry {
  // Two journeys, three scripts (one library), one ESV, one theme, one
  // email template, one social IdP. Inbound-ref shape designed to give
  // every query case something to assert.
  const entities: Record<string, RealmIndexEntity> = {};
  const add = (e: RealmIndexEntity) => {
    entities[e.key] = e;
  };
  add(ent("journey", "Login", "Login"));
  add(ent("journey", "Login-MFA", "Login-MFA"));
  add(ent("script", "s-validator", "validator"));
  add(ent("script", "s-helpers", "helpers", { isLibrary: true }));
  add(ent("script", "s-orphan", "orphan-script")); // no inbound refs
  add(ent("esv", "esv.api.key", "esv.api.key", { esvKind: "variable" }));
  add(ent("esv", "esv.unused", "esv.unused", { esvKind: "secret" })); // orphan
  add(ent("theme", "t-corp", "corporate"));
  add(ent("emailTemplate", "welcome", "welcome"));
  add(ent("socialIdp", "google", "google"));

  const inboundRefs: Record<string, ReturnType<typeof refsOf>> = {};
  function refsOf(...refs: Array<{ fromKey: string; via: string }>) {
    return refs;
  }
  inboundRefs[entityKeyOf("script", "s-validator")] = refsOf(
    { fromKey: entityKeyOf("journey", "Login"), via: "ScriptedDecisionNode" },
    { fromKey: entityKeyOf("journey", "Login-MFA"), via: "ScriptedDecisionNode" },
  );
  inboundRefs[entityKeyOf("script", "s-helpers")] = refsOf({
    fromKey: entityKeyOf("script", "s-validator"),
    via: "require()",
  });
  inboundRefs[entityKeyOf("esv", "esv.api.key")] = refsOf({
    fromKey: entityKeyOf("script", "s-validator"),
    via: "string literal",
  });
  inboundRefs[entityKeyOf("theme", "t-corp")] = refsOf({
    fromKey: entityKeyOf("journey", "Login"),
    via: "PageNode",
  });
  inboundRefs[entityKeyOf("emailTemplate", "welcome")] = refsOf({
    fromKey: entityKeyOf("journey", "Login-MFA"),
    via: "EmailSuspendNode",
  });
  inboundRefs[entityKeyOf("socialIdp", "google")] = refsOf({
    fromKey: entityKeyOf("journey", "Login"),
    via: "SelectIdPNode",
  });

  return {
    host: HOST,
    realm: REALM,
    entities,
    inboundRefs,
    counts: {
      journey: 2,
      script: 3,
      esv: 2,
      theme: 1,
      emailTemplate: 1,
      socialIdp: 1,
    },
    builtAt: 1_700_000_000_000,
    scanDurationMs: 1234,
  };
}

describe("findUsages", () => {
  const entry = buildEntry();

  it("returns inbound refs for an existing target", () => {
    const refs = findUsages(entry, entityKeyOf("script", "s-validator"));
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.fromKey)).toEqual([
      entityKeyOf("journey", "Login"),
      entityKeyOf("journey", "Login-MFA"),
    ]);
    expect(refs.every((r) => r.via === "ScriptedDecisionNode")).toBe(true);
  });

  it("returns [] for an unknown target", () => {
    expect(findUsages(entry, entityKeyOf("script", "nonexistent"))).toEqual([]);
  });

  it("returns [] for an entity that exists but has no inbound refs", () => {
    expect(findUsages(entry, entityKeyOf("script", "s-orphan"))).toEqual([]);
  });
});

describe("searchByName", () => {
  const entry = buildEntry();

  it("matches case-insensitively", () => {
    const r = searchByName(entry, "login");
    expect(r.map((e) => e.id)).toEqual(["Login", "Login-MFA"]);
  });

  it("supports partial substring (mfa matches Login-MFA)", () => {
    const r = searchByName(entry, "mfa");
    expect(r.map((e) => e.id)).toEqual(["Login-MFA"]);
  });

  it("respects the kinds filter when supplied", () => {
    // Substring "r" hits "validator", "helpers", "orphan-script", and
    // "corporate". Only the three scripts come back when filtering to
    // kind "script". Sorted alphabetically by displayName.
    const r = searchByName(entry, "r", ["script"]);
    expect(r.map((e) => e.id)).toEqual(["s-helpers", "s-orphan", "s-validator"]);
  });

  it("returns results sorted by displayName (locale-aware case-insensitive)", () => {
    const r = searchByName(entry, "r");
    const names = r.map((e) => e.displayName);
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    expect(names).toEqual(sorted);
  });

  it("returns [] on empty pattern (no work until the user types)", () => {
    expect(searchByName(entry, "")).toEqual([]);
    expect(searchByName(entry, "   ")).toEqual([]);
  });

  it("returns [] on pattern that matches nothing", () => {
    expect(searchByName(entry, "no-such-entity")).toEqual([]);
  });

  it("returns all matching kinds when kinds is omitted", () => {
    // Pattern "o" matches: "Login" (no — has no "o"… actually it does: L-o-g-i-n),
    // "Login-MFA" (no o), "google" (yes), "orphan-script" (yes), "corporate" (yes).
    // Both google + orphan-script + corporate + Login should appear.
    const r = searchByName(entry, "o");
    const ids = r.map((e) => e.id).sort();
    expect(ids).toContain("Login");
    expect(ids).toContain("Login-MFA"); // contains "o" in Login
    expect(ids).toContain("google");
    expect(ids).toContain("s-orphan");
    expect(ids).toContain("t-corp");
  });
});

describe("findUnused", () => {
  const entry = buildEntry();

  it("returns entities with zero inbound refs", () => {
    const orphans = findUnused(entry);
    const ids = orphans.map((e) => e.id);
    expect(ids).toContain("s-orphan");
    expect(ids).toContain("esv.unused");
  });

  it("excludes journeys by default regardless of inbound state", () => {
    const orphans = findUnused(entry);
    expect(orphans.every((e) => e.kind !== "journey")).toBe(true);
  });

  it("excludes entities that have at least one inbound ref", () => {
    const orphans = findUnused(entry);
    const ids = orphans.map((e) => e.id);
    expect(ids).not.toContain("s-validator");
    expect(ids).not.toContain("s-helpers");
    expect(ids).not.toContain("esv.api.key");
    expect(ids).not.toContain("t-corp");
  });

  it("respects an explicit kinds filter scoped to scripts", () => {
    const orphans = findUnused(entry, ["script"]);
    const ids = orphans.map((e) => e.id);
    expect(ids).toEqual(["s-orphan"]);
  });

  it("honors a caller-supplied kinds list that includes 'journey'", () => {
    // Both "Login" and "Login-MFA" have no inbound refs (they're roots).
    // Caller explicitly asked for them — return both.
    const orphans = findUnused(entry, ["journey"]);
    const ids = orphans.map((e) => e.id).sort();
    expect(ids).toEqual(["Login", "Login-MFA"]);
  });

  it("returns results sorted by displayName", () => {
    const orphans = findUnused(entry);
    const names = orphans.map((e) => e.displayName);
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    expect(names).toEqual(sorted);
  });
});

// ─── findUsagePaths ──────────────────────────────────────────────────────

/** Build a minimal entry from a flat list of entities + directed edges
 * `[fromKey, toKey, via]`. `inboundRefs` is the inverted edge map. */
function pathEntry(
  entities: RealmIndexEntity[],
  edges: Array<[string, string, string]>,
): RealmIndexEntry {
  const entMap: Record<string, RealmIndexEntity> = {};
  for (const e of entities) entMap[e.key] = e;
  const inboundRefs: Record<string, ReverseRef[]> = {};
  for (const [from, to, via] of edges) {
    const list = inboundRefs[to] ?? [];
    list.push({ fromKey: from, via });
    inboundRefs[to] = list;
  }
  return {
    host: HOST,
    realm: REALM,
    entities: entMap,
    inboundRefs,
    counts: { journey: 0, script: 0, esv: 0, theme: 0, emailTemplate: 0, socialIdp: 0 },
    builtAt: 1_700_000_000_000,
    scanDurationMs: 1,
  };
}

describe("findUsagePaths", () => {
  it("returns an empty tree for an unknown target", () => {
    const entry = pathEntry([ent("journey", "Login", "Login")], []);
    expect(findUsagePaths(entry, entityKeyOf("esv", "nope"))).toEqual({
      targetKey: entityKeyOf("esv", "nope"),
      roots: [],
    });
  });

  it("renders a linear journey → script → esv chain with the target as leaf", () => {
    const j = ent("journey", "Login", "Login");
    const s = ent("script", "s1", "validator");
    const esv = ent("esv", "esv.x", "esv.x", { esvKind: "variable" });
    const entry = pathEntry(
      [j, s, esv],
      [
        [j.key, s.key, "ScriptedDecisionNode"],
        [s.key, esv.key, "string literal"],
      ],
    );
    const paths = findUsagePaths(entry, esv.key);
    expect(paths.roots).toHaveLength(1);
    const root = paths.roots[0];
    expect(root.key).toBe(j.key);
    expect(root.via).toBeUndefined();
    expect(root.children).toHaveLength(1);
    expect(root.children[0].key).toBe(s.key);
    expect(root.children[0].via).toBe("ScriptedDecisionNode");
    const leaf = root.children[0].children[0];
    expect(leaf.key).toBe(esv.key);
    expect(leaf.via).toBe("string literal");
    expect(leaf.children).toEqual([]);
  });

  it("yields one root per journey that reaches the target", () => {
    const j1 = ent("journey", "Login", "Login");
    const j2 = ent("journey", "Registration", "Registration");
    const s = ent("script", "s1", "shared");
    const esv = ent("esv", "esv.x", "esv.x");
    const entry = pathEntry(
      [j1, j2, s, esv],
      [
        [j1.key, s.key, "ScriptedDecisionNode"],
        [j2.key, s.key, "ScriptedDecisionNode"],
        [s.key, esv.key, "string literal"],
      ],
    );
    const paths = findUsagePaths(entry, esv.key);
    expect(paths.roots.map((r) => r.entity.id)).toEqual(["Login", "Registration"]);
  });

  it("collapses a repeated subtree to a `dup` marker (first displayed wins)", () => {
    const j1 = ent("journey", "AAA", "AAA");
    const j2 = ent("journey", "BBB", "BBB");
    const lib = ent("script", "lib", "helpers", { isLibrary: true });
    const esv = ent("esv", "esv.x", "esv.x");
    const entry = pathEntry(
      [j1, j2, lib, esv],
      [
        [j1.key, lib.key, "ScriptedDecisionNode"],
        [j2.key, lib.key, "ScriptedDecisionNode"],
        [lib.key, esv.key, "string literal"],
      ],
    );
    const paths = findUsagePaths(entry, esv.key);
    // AAA sorts first → renders `helpers` (+ its esv child) in full.
    const aaa = paths.roots[0].children[0];
    expect(aaa.dup).toBeUndefined();
    expect(aaa.children).toHaveLength(1);
    // BBB's `helpers` is the repeat → dup marker, not recursed.
    const bbb = paths.roots[1].children[0];
    expect(bbb.dup).toBe(true);
    expect(bbb.children).toEqual([]);
  });

  it("terminates on a journey cycle and dup-marks the back-edge", () => {
    // Outer → InnerA → InnerB → InnerA (cycle), InnerB → esv.
    const outer = ent("journey", "Outer", "Outer");
    const a = ent("journey", "InnerA", "InnerA");
    const b = ent("journey", "InnerB", "InnerB");
    const esv = ent("esv", "esv.x", "esv.x");
    const entry = pathEntry(
      [outer, a, b, esv],
      [
        [outer.key, a.key, "InnerTreeEvaluatorNode"],
        [a.key, b.key, "InnerTreeEvaluatorNode"],
        [b.key, a.key, "InnerTreeEvaluatorNode"],
        [b.key, esv.key, "string literal"],
      ],
    );
    const paths = findUsagePaths(entry, esv.key);
    // Walk Outer → InnerA → InnerB; InnerB's edge back to InnerA is a dup.
    const innerA = paths.roots[0].children[0];
    const innerB = innerA.children.find((c) => c.entity.id === "InnerB");
    expect(innerB).toBeDefined();
    const backEdge = innerB?.children.find((c) => c.entity.id === "InnerA");
    expect(backEdge?.dup).toBe(true);
  });

  it("flags a non-journey root as `orphanRoot` (target kept alive by dead code)", () => {
    // A script uses the ESV but no journey reaches the script.
    const s = ent("script", "orphan", "orphan-script");
    const esv = ent("esv", "esv.x", "esv.x");
    const entry = pathEntry([s, esv], [[s.key, esv.key, "string literal"]]);
    const paths = findUsagePaths(entry, esv.key);
    expect(paths.roots).toHaveLength(1);
    expect(paths.roots[0].entity.id).toBe("orphan");
    expect(paths.roots[0].orphanRoot).toBe(true);
  });

  it("a never-referenced target is its own single-node orphan root", () => {
    const esv = ent("esv", "esv.lonely", "esv.lonely");
    const entry = pathEntry([esv], []);
    const paths = findUsagePaths(entry, esv.key);
    expect(paths.roots).toHaveLength(1);
    expect(paths.roots[0].key).toBe(esv.key);
    expect(paths.roots[0].orphanRoot).toBe(true);
    expect(paths.roots[0].children).toEqual([]);
  });
});
