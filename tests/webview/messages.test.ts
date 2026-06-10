import { describe, expect, it } from "vitest";
import type { Connection, Journey, Realm } from "@/domain/types";
import { type E2W, isE2W, isW2E, type SelectPayload, type W2E } from "@/webview/messages";

const REALM: Realm = { name: "alpha", active: true, parentPath: "/", isRoot: false };
const CONN: Connection = { kind: "paic", host: "h.example.com", saId: "sa-1" };
const JOURNEY: Journey = { id: "Login", enabled: true, entryNodeId: "e", nodes: {} };

describe("messages protocol", () => {
  it("select payload narrows by `kind` discriminant", () => {
    const variants: SelectPayload[] = [
      { kind: "connection", uid: "u1", connection: CONN },
      { kind: "realm", uid: "u2", host: CONN.host, realm: REALM },
      { kind: "journey", uid: "u3", host: CONN.host, realmName: "alpha", journey: JOURNEY },
      {
        kind: "innerJourney",
        uid: "u4",
        host: CONN.host,
        realmName: "alpha",
        journey: JOURNEY,
        visited: ["Login"],
      },
      {
        kind: "script",
        uid: "u5",
        host: CONN.host,
        realmName: "alpha",
        scriptId: "s-1",
      },
      { kind: "message", uid: "u6", label: "Loading" },
    ];

    for (const v of variants) {
      // Narrowing assertion — if the discriminant works at runtime + type level,
      // each branch sees the right field.
      switch (v.kind) {
        case "connection":
          expect(v.connection.host).toBe("h.example.com");
          break;
        case "realm":
          expect(v.realm.name).toBe("alpha");
          break;
        case "journey":
          expect(v.journey.id).toBe("Login");
          break;
        case "innerJourney":
          expect(v.visited).toContain("Login");
          break;
        case "script":
          expect(v.scriptId).toBe("s-1");
          break;
        case "message":
          expect(v.label).toBe("Loading");
          break;
      }
    }
  });

  it("E2W type guard accepts known types and rejects others", () => {
    const select: E2W = {
      type: "select",
      payload: { kind: "connection", uid: "u1", connection: CONN },
    };
    const deps: E2W = {
      type: "journeyDeps",
      uid: "u3",
      scripts: [],
      inners: [],
      themes: [],
      emailTemplates: [],
      socialIdps: [],
      nodeIndex: {},
    };
    const err: E2W = { type: "error", message: "boom" };
    const resolveOk: E2W = {
      type: "resolveResult",
      ok: true,
      graph: {
        rootKey: "journey:Login",
        nodes: {
          "journey:Login": {
            key: "journey:Login",
            kind: "journey",
            id: "Login",
            displayName: "Login",
            depth: 0,
          },
        },
        edges: [],
        durationMs: 1,
      },
    };
    const resolveErr: E2W = { type: "resolveResult", ok: false, message: "boom" };
    expect(isE2W(select)).toBe(true);
    expect(isE2W(deps)).toBe(true);
    expect(isE2W(err)).toBe(true);
    expect(isE2W(resolveOk)).toBe(true);
    expect(isE2W(resolveErr)).toBe(true);

    expect(isE2W({ type: "previewNode", uid: "x" })).toBe(false); // W2E shape
    expect(isE2W(null)).toBe(false);
    expect(isE2W("string")).toBe(false);
    expect(isE2W({})).toBe(false);
  });

  it("W2E type guard accepts known types and rejects others", () => {
    const ready: W2E = { type: "ready" };
    const preview: W2E = { type: "previewNode", uid: "u1" };
    const resolveFull: W2E = { type: "resolveFull" };
    const refreshResolved: W2E = { type: "refreshResolved" };
    const findUsages: W2E = {
      type: "findUsages",
      host: "h.example.com",
      realm: "alpha",
      kind: "script",
      id: "s-1",
      displayName: "validator",
    };
    expect(isW2E(ready)).toBe(true);
    expect(isW2E(preview)).toBe(true);
    expect(isW2E(resolveFull)).toBe(true);
    expect(isW2E(refreshResolved)).toBe(true);
    expect(isW2E(findUsages)).toBe(true);

    expect(isW2E({ type: "select", payload: {} })).toBe(false); // E2W shape
    expect(isW2E(undefined)).toBe(false);
    expect(isW2E({})).toBe(false);
  });

  it("error payload allows optional uid", () => {
    const withUid: E2W = { type: "error", uid: "u1", message: "boom" };
    const withoutUid: E2W = { type: "error", message: "boom" };
    expect(isE2W(withUid)).toBe(true);
    expect(isE2W(withoutUid)).toBe(true);
  });

  it("journeyDeps carries arrays of NodeRefs plus a nodeIndex", () => {
    const m: E2W = {
      type: "journeyDeps",
      uid: "u3",
      scripts: [{ uid: "script:h:alpha:s-1", label: "s-1", kind: "script" }],
      inners: [{ uid: "inner:h:alpha:Inner:Login", label: "Inner", kind: "innerJourney" }],
      themes: [{ uid: "theme:h:alpha:t1", label: "t1", kind: "theme" }],
      emailTemplates: [
        { uid: "email-template:h:alpha:Welcome", label: "Welcome", kind: "emailTemplate" },
      ],
      socialIdps: [
        { uid: "social-idp:h:alpha:google-oidc", label: "google-oidc", kind: "socialIdp" },
      ],
      nodeIndex: {
        n1: { kind: "script", scriptId: "s-1", uid: "script:h:alpha:s-1" },
        n2: { kind: "inner", innerTreeId: "Inner", uid: "inner:h:alpha:Inner:Login" },
      },
    };
    if (m.type !== "journeyDeps") throw new Error("narrowing failed");
    expect(m.scripts).toHaveLength(1);
    expect(m.scripts[0].kind).toBe("script");
    expect(m.inners[0].kind).toBe("innerJourney");
    expect(m.nodeIndex.n1?.scriptId).toBe("s-1");
    expect(m.nodeIndex.n2?.innerTreeId).toBe("Inner");
  });
});
