import { describe, expect, it } from "vitest";
import {
  mapEmailTemplate,
  mapEsvSecret,
  mapEsvVariable,
  mapJourney,
  mapNodePayload,
  mapRealm,
  mapScript,
  mapSocialIdp,
  mapTheme,
  type RawEmailTemplate,
  type RawEsvSecret,
  type RawEsvVariable,
  type RawJourney,
  type RawNodePayload,
  type RawScript,
  type RawSocialIdp,
  type RawTheme,
} from "@/paic/mappers";

describe("mapRealm", () => {
  it("extracts name/active/parentPath; defaults parentPath to '/'", () => {
    expect(
      mapRealm({
        _id: "uuid-1",
        name: "alpha",
        active: true,
        parentPath: "/",
        aliases: ["customers"],
      }),
    ).toEqual({ name: "alpha", active: true, parentPath: "/" });

    expect(mapRealm({ name: "beta", active: false } as never)).toEqual({
      name: "beta",
      active: false,
      parentPath: "/",
    });
  });
});

describe("mapJourney", () => {
  it("lifts nodes inline and defaults missing fields", () => {
    const raw: RawJourney = {
      _id: "Login",
      _rev: "abc",
      description: "Standard sign-in",
      enabled: true,
      identityResource: "managed/alpha_user",
      entryNodeId: "node-entry-uuid",
      nodes: {
        "node-1": {
          nodeType: "ScriptedDecisionNode",
          displayName: "Script:SetSessionAssurance",
          connections: { true: "node-2" },
          x: 100,
          y: 200,
        },
        "node-2": { nodeType: "SuccessNode" },
      },
    };
    const j = mapJourney(raw);
    expect(j.id).toBe("Login");
    expect(j.description).toBe("Standard sign-in");
    expect(j.enabled).toBe(true);
    expect(j.identityResource).toBe("managed/alpha_user");
    expect(j.entryNodeId).toBe("node-entry-uuid");
    expect(j.nodes["node-1"].nodeType).toBe("ScriptedDecisionNode");
    expect(j.nodes["node-1"].connections).toEqual({ true: "node-2" });
    expect(j.nodes["node-2"].connections).toEqual({});
  });

  it("defaults enabled to false when omitted", () => {
    const raw: RawJourney = { _id: "x", entryNodeId: "e" };
    expect(mapJourney(raw).enabled).toBe(false);
  });
});

describe("mapNodePayload", () => {
  it("extracts scriptId from a ScriptedDecisionNode payload", () => {
    const raw: RawNodePayload = {
      _id: "node-uuid",
      _type: { _id: "ScriptedDecisionNode" },
      script: "script-uuid-1",
      outcomes: ["true", "false"],
      inputs: ["*"],
      outputs: ["*"],
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("ScriptedDecisionNode");
    if (p.nodeType === "ScriptedDecisionNode") {
      expect(p.scriptId).toBe("script-uuid-1");
      expect(p.outcomes).toEqual(["true", "false"]);
      expect(p.inputs).toEqual(["*"]);
      expect(p.outputs).toEqual(["*"]);
    }
  });

  it("extracts tree name from an InnerTreeEvaluatorNode payload", () => {
    const raw: RawNodePayload = {
      _id: "node-uuid",
      _type: { _id: "InnerTreeEvaluatorNode" },
      tree: "PasswordReset",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("InnerTreeEvaluatorNode");
    if (p.nodeType === "InnerTreeEvaluatorNode") {
      expect(p.tree).toBe("PasswordReset");
    }
  });

  it("maps a ClientScriptNode payload to its variant with scriptId", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "ClientScriptNode" },
      script: "client-script-uuid",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("ClientScriptNode");
    if (p.nodeType === "ClientScriptNode") expect(p.scriptId).toBe("client-script-uuid");
  });

  it("maps a ConfigProviderNode payload to its variant with scriptId", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "ConfigProviderNode" },
      script: "cfg-script-uuid",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("ConfigProviderNode");
    if (p.nodeType === "ConfigProviderNode") expect(p.scriptId).toBe("cfg-script-uuid");
  });

  it("maps a SocialProviderHandlerNode payload with scriptId + filteredProviders array", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "SocialProviderHandlerNode" },
      script: "social-script-uuid",
      filteredProviders: ["google-oidc", "apple-oidc"],
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("SocialProviderHandlerNode");
    if (p.nodeType === "SocialProviderHandlerNode") {
      expect(p.scriptId).toBe("social-script-uuid");
      expect(p.filteredProviders).toEqual(["google-oidc", "apple-oidc"]);
    }
  });

  it("maps a SocialProviderHandlerNodeV2 payload — missing filteredProviders becomes empty array", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "SocialProviderHandlerNodeV2" },
      script: "social-v2-script-uuid",
      // filteredProviders intentionally absent.
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("SocialProviderHandlerNodeV2");
    if (p.nodeType === "SocialProviderHandlerNodeV2") {
      expect(p.scriptId).toBe("social-v2-script-uuid");
      expect(p.filteredProviders).toEqual([]);
    }
  });

  it("maps a DeviceMatchNode payload — useScript:true carries scriptId", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "DeviceMatchNode" },
      useScript: true,
      script: "device-script-uuid",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("DeviceMatchNode");
    if (p.nodeType === "DeviceMatchNode") {
      expect(p.useScript).toBe(true);
      expect(p.scriptId).toBe("device-script-uuid");
    }
  });

  it("maps a PingOneVerifyCompletionDecisionNode payload — useFilterScript:false preserves any stale scriptId", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "PingOneVerifyCompletionDecisionNode" },
      useFilterScript: false,
      script: "stale-script-uuid",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("PingOneVerifyCompletionDecisionNode");
    if (p.nodeType === "PingOneVerifyCompletionDecisionNode") {
      expect(p.useFilterScript).toBe(false);
      // The mapper preserves the raw scriptId; the D19 predicate decides activation.
      expect(p.scriptId).toBe("stale-script-uuid");
    }
  });

  it("maps a PageNode payload — JSON stage form, child refs preserved", () => {
    const raw: RawNodePayload = {
      _id: "n-page",
      _type: { _id: "PageNode" },
      stage: JSON.stringify({ themeId: "theme-uuid-1", header: "Hello" }),
      nodes: [
        { _id: "n-child-1", nodeType: "UsernameCollectorNode" },
        { _id: "n-child-2", nodeType: "PasswordCollectorNode" },
      ],
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("PageNode");
    if (p.nodeType === "PageNode") {
      expect(p.themeId).toBe("theme-uuid-1");
      expect(p.childRefs).toEqual([
        { id: "n-child-1", nodeType: "UsernameCollectorNode" },
        { id: "n-child-2", nodeType: "PasswordCollectorNode" },
      ]);
    }
  });

  it("maps a PageNode payload — legacy `themeId=<id>` stage form", () => {
    const raw: RawNodePayload = {
      _id: "n-page",
      _type: { _id: "PageNode" },
      stage: "themeId=theme-legacy-uuid",
    };
    const p = mapNodePayload(raw);
    if (p.nodeType === "PageNode") {
      expect(p.themeId).toBe("theme-legacy-uuid");
      expect(p.childRefs).toEqual([]);
    }
  });

  it("maps a PageNode payload — no stage → themeId undefined", () => {
    const raw: RawNodePayload = { _id: "n-page", _type: { _id: "PageNode" } };
    const p = mapNodePayload(raw);
    if (p.nodeType === "PageNode") expect(p.themeId).toBeUndefined();
  });

  it("maps an EmailSuspendNode payload to its variant with emailTemplateName", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "EmailSuspendNode" },
      emailTemplateName: "PasswordResetMail",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("EmailSuspendNode");
    if (p.nodeType === "EmailSuspendNode") {
      expect(p.emailTemplateName).toBe("PasswordResetMail");
    }
  });

  it("maps an EmailTemplateNode payload (same shape as EmailSuspendNode)", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "EmailTemplateNode" },
      emailTemplateName: "WelcomeMail",
    };
    const p = mapNodePayload(raw);
    if (p.nodeType === "EmailTemplateNode") expect(p.emailTemplateName).toBe("WelcomeMail");
  });

  it("maps a SelectIdPNode payload — preserves filteredProviders; absent field → empty array", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "SelectIdPNode" },
      filteredProviders: ["google-oidc", "apple-oidc"],
    };
    const p = mapNodePayload(raw);
    if (p.nodeType === "SelectIdPNode") {
      expect(p.filteredProviders).toEqual(["google-oidc", "apple-oidc"]);
    }
    const noField = mapNodePayload({ _id: "n2", _type: { _id: "SelectIdPNode" } });
    if (noField.nodeType === "SelectIdPNode") expect(noField.filteredProviders).toEqual([]);
  });

  it("falls through to OtherNodePayload for unknown node types, preserving raw + rawNodeType", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "UsernameCollectorNode" }, // a typed AIC node we haven't widened yet
      // extra field that should land in raw
      validateInput: true,
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("other");
    if (p.nodeType === "other") {
      expect(p.rawNodeType).toBe("UsernameCollectorNode");
      expect(p.raw.validateInput).toBe(true);
    }
  });
});

describe("mapTheme + mapEmailTemplate + mapSocialIdp + mapEsv*", () => {
  it("mapTheme extracts _id + name and bakes in the realm", () => {
    const raw: RawTheme = { _id: "theme-uuid", name: "Default" };
    expect(mapTheme("alpha", raw)).toEqual({ id: "theme-uuid", name: "Default", realm: "alpha" });
  });

  it("mapEmailTemplate carries enabled / from / subject / message; defaults enabled=false", () => {
    const raw: RawEmailTemplate = {
      enabled: true,
      from: "noreply@example.com",
      subject: { en: "Hi" },
      message: { en: "Hello" },
    };
    expect(mapEmailTemplate("welcome", raw)).toEqual({
      name: "welcome",
      enabled: true,
      from: "noreply@example.com",
      subject: { en: "Hi" },
      message: { en: "Hello" },
    });
    expect(mapEmailTemplate("x", {}).enabled).toBe(false);
  });

  it("mapSocialIdp extracts name, type, enabled — defaults enabled=false", () => {
    const raw: RawSocialIdp = {
      _id: "google-oidc",
      _type: { _id: "googleSocialAuthentication" },
      enabled: true,
    };
    expect(mapSocialIdp("alpha", raw)).toEqual({
      name: "google-oidc",
      type: "googleSocialAuthentication",
      enabled: true,
      realm: "alpha",
    });
  });

  it("mapEsvVariable carries description + expressionType + lastChangeDate", () => {
    const raw: RawEsvVariable = {
      description: "Public URL",
      expressionType: "string",
      lastChangeDate: "2026-05-01T00:00:00Z",
    };
    expect(mapEsvVariable("PUBLIC_URL", raw)).toEqual({
      kind: "variable",
      name: "PUBLIC_URL",
      description: "Public URL",
      expressionType: "string",
      lastChangeDate: "2026-05-01T00:00:00Z",
    });
  });

  it("mapEsvSecret carries description + encoding + lastChangeDate", () => {
    const raw: RawEsvSecret = {
      description: "Signing key",
      encoding: "base64",
      lastChangeDate: "2026-05-01T00:00:00Z",
    };
    expect(mapEsvSecret("SIGNING_KEY", raw)).toEqual({
      kind: "secret",
      name: "SIGNING_KEY",
      description: "Signing key",
      encoding: "base64",
      lastChangeDate: "2026-05-01T00:00:00Z",
    });
  });
});

describe("mapScript", () => {
  it("decodes a base64-encoded body to UTF-8", () => {
    const source = "var x = 1;\nreturn x;";
    const b64 = Buffer.from(source, "utf8").toString("base64");
    const raw: RawScript = { _id: "s1", name: "MyScript", language: "JAVASCRIPT", script: b64 };
    expect(mapScript(raw)).toEqual({
      id: "s1",
      name: "MyScript",
      language: "JAVASCRIPT",
      body: source,
    });
  });

  it("returns empty body when script field is missing", () => {
    expect(mapScript({ _id: "s2", name: "Empty" }).body).toBe("");
  });

  it("defaults language to JAVASCRIPT when not provided", () => {
    expect(mapScript({ _id: "s3", name: "x" }).language).toBe("JAVASCRIPT");
  });
});
