import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, it } from "vitest";
import { makePaicClient, type PaicClient, type PaicClientOptions } from "@/paic/client";
import type { HttpClient, PaicRequestConfig } from "@/paic/http";

// In-memory fake HttpClient that records every call and serves canned responses.
interface FakeCall {
  method: "GET" | "POST";
  url: string;
  apiVersion?: string;
}

function makeFakeHttp(): {
  http: HttpClient;
  calls: FakeCall[];
  /** Push a canned response to be returned by the NEXT call to `http.get` (FIFO). */
  enqueueGet: <T>(data: T) => void;
  /** Same, but for POST. Not used at M1 but kept for completeness. */
  enqueuePost: <T>(data: T) => void;
} {
  const calls: FakeCall[] = [];
  const getQueue: unknown[] = [];
  const postQueue: unknown[] = [];

  function build<T>(data: T): AxiosResponse<T> {
    return {
      data,
      status: 200,
      statusText: "OK",
      headers: {},
      // biome-ignore lint/suspicious/noExplicitAny: test stub; the real config shape is opaque
      config: {} as any,
    };
  }

  const http: HttpClient = {
    get: <T>(url: string, config?: PaicRequestConfig) => {
      calls.push({ method: "GET", url, apiVersion: config?.apiVersion });
      const next = getQueue.shift();
      if (next === undefined) {
        return Promise.reject(new Error(`unexpected GET ${url} — no canned response`));
      }
      return Promise.resolve(build<T>(next as T));
    },
    post: <T>(url: string, _data?: unknown, config?: PaicRequestConfig) => {
      calls.push({ method: "POST", url, apiVersion: config?.apiVersion });
      const next = postQueue.shift();
      if (next === undefined) {
        return Promise.reject(new Error(`unexpected POST ${url} — no canned response`));
      }
      return Promise.resolve(build<T>(next as T));
    },
  };

  return {
    http,
    calls,
    enqueueGet: (data) => getQueue.push(data),
    enqueuePost: (data) => postQueue.push(data),
  };
}

function makeFakeLogger(): PaicClientOptions["log"] {
  const noop = () => undefined;
  const self: PaicClientOptions["log"] = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => self,
    // biome-ignore lint/suspicious/noExplicitAny: pino Logger has many fields we don't use
  } as any;
  return self;
}

let client: PaicClient;
let fake: ReturnType<typeof makeFakeHttp>;

beforeEach(() => {
  fake = makeFakeHttp();
  client = makePaicClient({ http: fake.http, log: makeFakeLogger() });
});

describe("PaicClient", () => {
  it("listRealms calls /am/json/global-config/realms with the realm API version", async () => {
    fake.enqueueGet({
      result: [
        { _id: "1", name: "alpha", active: true, parentPath: "/" },
        { _id: "2", name: "beta", active: false, parentPath: "/" },
      ],
      pagedResultsCookie: null,
    });

    const realms = await client.listRealms();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe("/am/json/global-config/realms?_queryFilter=true");
    expect(fake.calls[0].apiVersion).toBe("protocol=2.0,resource=1.0");
    expect(realms).toEqual([
      { name: "alpha", active: true, parentPath: "/", isRoot: false },
      { name: "beta", active: false, parentPath: "/", isRoot: false },
    ]);
  });

  it("listJourneys builds the realm-pathed URL and follows pagedResultsCookie", async () => {
    fake.enqueueGet({
      result: [
        {
          _id: "Login",
          enabled: true,
          entryNodeId: "e",
          nodes: {},
        },
      ],
      pagedResultsCookie: "abc",
    });
    fake.enqueueGet({
      result: [
        {
          _id: "Registration",
          enabled: false,
          entryNodeId: "e2",
          nodes: {},
        },
      ],
      pagedResultsCookie: null,
    });

    const journeys = await client.listJourneys("alpha");

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].url).toBe(
      "/am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/trees?_queryFilter=true",
    );
    expect(fake.calls[0].apiVersion).toBe("protocol=2.1,resource=1.0");
    // Second call carries the cookie.
    expect(fake.calls[1].url).toContain("_pagedResultsCookie=abc");
    expect(journeys.map((j) => j.id)).toEqual(["Login", "Registration"]);
  });

  it("getJourney URL-encodes the journey ID", async () => {
    fake.enqueueGet({
      _id: "kyid/2B1",
      enabled: true,
      entryNodeId: "e",
      nodes: {},
    });

    await client.getJourney("alpha", "kyid/2B1");

    expect(fake.calls[0].url).toBe(
      "/am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/trees/kyid%2F2B1",
    );
    expect(fake.calls[0].apiVersion).toBe("protocol=2.1,resource=1.0");
  });

  it("getNode embeds nodeType and nodeId in the URL and returns a mapped payload", async () => {
    fake.enqueueGet({
      _id: "node-uuid",
      _type: { _id: "ScriptedDecisionNode" },
      script: "script-uuid-7",
      outcomes: ["true", "false"],
      inputs: ["*"],
      outputs: ["*"],
    });

    const node = await client.getNode("alpha", "ScriptedDecisionNode", "node-uuid");

    expect(fake.calls[0].url).toBe(
      "/am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/nodes/ScriptedDecisionNode/node-uuid",
    );
    expect(node.nodeType).toBe("ScriptedDecisionNode");
    if (node.nodeType === "ScriptedDecisionNode") {
      expect(node.scriptId).toBe("script-uuid-7");
      expect(node.outcomes).toEqual(["true", "false"]);
    }
  });

  it("getScript uses the script API version and decodes the body", async () => {
    const source = "function go(){ return 'ok'; }";
    fake.enqueueGet({
      _id: "s-1",
      name: "GoScript",
      language: "JAVASCRIPT",
      script: Buffer.from(source, "utf8").toString("base64"),
    });

    const script = await client.getScript("alpha", "s-1");

    expect(fake.calls[0].url).toBe("/am/json/realms/root/realms/alpha/scripts/s-1");
    expect(fake.calls[0].apiVersion).toBe("protocol=2.0,resource=1.0");
    expect(script).toEqual({
      id: "s-1",
      name: "GoScript",
      language: "JAVASCRIPT",
      body: source,
    });
  });

  it("getTheme fetches the whole themerealm config and filters by realm + id", async () => {
    // The wire shape uses `realm` (singular) and the value is the theme
    // array directly — no `.themes` wrapper. Verified against sb3 via the
    // theme-probe POC.
    fake.enqueueGet({
      realm: {
        alpha: [
          { _id: "theme-1", name: "Default", isDefault: true },
          {
            _id: "theme-2",
            name: "Custom",
            primaryColor: "#3057A4",
            linkedTrees: ["JourneyA", "JourneyB"],
            logo: { en: "https://example.com/logo.svg" },
            logoAltText: { en: "Logo" },
          },
        ],
        beta: [{ _id: "theme-3", name: "Other" }],
      },
    });
    const found = await client.getTheme("alpha", "theme-2");
    expect(fake.calls[0].url).toBe("/openidm/config/ui/themerealm");
    expect(found).toMatchObject({
      id: "theme-2",
      name: "Custom",
      realm: "alpha",
      primaryColor: "#3057A4",
      linkedTrees: ["JourneyA", "JourneyB"],
      logo: { en: "https://example.com/logo.svg" },
    });

    fake.enqueueGet({
      realm: { alpha: [{ _id: "theme-1", name: "Default" }] },
    });
    const miss = await client.getTheme("alpha", "no-such-theme");
    expect(miss).toBeNull();
  });

  it("listThemes fetches /openidm/config/ui/themerealm once and returns all mapped themes for the realm", async () => {
    fake.enqueueGet({
      realm: {
        alpha: [
          { _id: "t1", name: "First", isDefault: true },
          { _id: "t2", name: "Second", primaryColor: "#3057A4" },
        ],
        beta: [{ _id: "t3", name: "BetaTheme" }],
      },
    });
    const themes = await client.listThemes("alpha");
    expect(fake.calls[0].url).toBe("/openidm/config/ui/themerealm");
    expect(themes.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(themes[0].isDefault).toBe(true);
    expect(themes[1].primaryColor).toBe("#3057A4");
  });

  it("getEmailTemplate fetches /openidm/config/emailTemplate/<name> and maps the result", async () => {
    fake.enqueueGet({
      _id: "emailTemplate/welcome",
      enabled: true,
      from: "noreply@example.com",
      subject: { en: "Hi" },
    });
    const t = await client.getEmailTemplate("welcome");
    expect(fake.calls[0].url).toBe("/openidm/config/emailTemplate/welcome");
    expect(t).toEqual({
      name: "welcome",
      enabled: true,
      from: "noreply@example.com",
      subject: { en: "Hi" },
      message: undefined,
    });
  });

  it("listSocialIdps POSTs _action=nextdescendents and maps the result array", async () => {
    fake.enqueuePost({
      result: [
        { _id: "google-oidc", _type: { _id: "googleSocialAuthentication" }, enabled: true },
        { _id: "apple-oidc", _type: { _id: "appleSocialAuthentication" }, enabled: false },
      ],
    });
    const idps = await client.listSocialIdps("alpha");
    expect(fake.calls[0].method).toBe("POST");
    expect(fake.calls[0].url).toBe(
      "/am/json/realms/root/realms/alpha/realm-config/services/SocialIdentityProviders?_action=nextdescendents",
    );
    expect(fake.calls[0].apiVersion).toBe("protocol=2.1,resource=1.0");
    expect(idps).toEqual([
      { name: "google-oidc", type: "googleSocialAuthentication", enabled: true, realm: "alpha" },
      { name: "apple-oidc", type: "appleSocialAuthentication", enabled: false, realm: "alpha" },
    ]);
  });

  it("getSocialIdp delegates to listSocialIdps and returns the matching entry", async () => {
    fake.enqueuePost({
      result: [
        { _id: "google-oidc", _type: { _id: "googleSocialAuthentication" }, enabled: true },
        { _id: "apple-oidc", _type: { _id: "appleSocialAuthentication" }, enabled: false },
      ],
    });
    const idp = await client.getSocialIdp("alpha", "apple-oidc");
    expect(idp).toEqual({
      name: "apple-oidc",
      type: "appleSocialAuthentication",
      enabled: false,
      realm: "alpha",
    });
  });

  it("getSocialIdp returns null when no IdP with that name exists in the realm", async () => {
    fake.enqueuePost({
      result: [{ _id: "google-oidc", _type: { _id: "googleSocialAuthentication" }, enabled: true }],
    });
    const idp = await client.getSocialIdp("alpha", "nonexistent");
    expect(idp).toBeNull();
  });

  it("getEsv tries /environment/variables/<name> first; returns mapped variable on hit", async () => {
    fake.enqueueGet({
      _id: "esv/variables/PUBLIC_URL",
      description: "Public URL",
      expressionType: "string",
    });
    const got = await client.getEsv("PUBLIC_URL");
    expect(fake.calls[0].url).toBe("/environment/variables/PUBLIC_URL");
    expect(fake.calls[0].apiVersion).toBe("protocol=1.0,resource=1.0");
    expect(got).toEqual({
      kind: "variable",
      name: "PUBLIC_URL",
      description: "Public URL",
      expressionType: "string",
      lastChangeDate: undefined,
    });
  });

  it("getEsv translates the dotted script-form name to the hyphenated REST id", async () => {
    // POC-validated against sb3: `/variables/esv.kyid.portal.name` → 400 from
    // the API; `/variables/esv-kyid-portal-name` → 200. Translate before URL,
    // keep the dotted name for display in the mapped result.
    fake.enqueueGet({
      _id: "esv-kyid-portal-name",
      description: "Portal name",
      expressionType: "string",
    });
    const got = await client.getEsv("esv.kyid.portal.name");
    expect(fake.calls[0].url).toBe("/environment/variables/esv-kyid-portal-name");
    expect(got).toEqual({
      kind: "variable",
      name: "esv.kyid.portal.name", // canonical display name stays dotted
      description: "Portal name",
      expressionType: "string",
      lastChangeDate: undefined,
    });
  });

  it("listVariables pages /environment/variables and translates hyphenated _ids to dotted names", async () => {
    fake.enqueueGet({
      result: [
        { _id: "esv-kyid-portal-name", expressionType: "string", loaded: true },
        { _id: "esv-tenant-fqdn", expressionType: "string", loaded: true },
      ],
      pagedResultsCookie: null,
    });
    const vars = await client.listVariables("alpha");
    expect(fake.calls[0].url).toBe("/environment/variables?_queryFilter=true");
    expect(fake.calls[0].apiVersion).toBe("protocol=1.0,resource=1.0");
    expect(vars.map((v) => v.name)).toEqual(["esv.kyid.portal.name", "esv.tenant.fqdn"]);
    expect(vars[0].kind).toBe("variable");
    expect(vars[0].loaded).toBe(true);
  });

  it("listSecrets pages /environment/secrets and returns dotted-name secrets with version fields", async () => {
    fake.enqueueGet({
      result: [
        {
          _id: "esv-ad-creds",
          encoding: "generic",
          loaded: true,
          activeVersion: "1",
          loadedVersion: "1",
          useInPlaceholders: true,
        },
      ],
      pagedResultsCookie: null,
    });
    const secs = await client.listSecrets("alpha");
    expect(fake.calls[0].url).toBe("/environment/secrets?_queryFilter=true");
    expect(secs[0]).toEqual({
      kind: "secret",
      name: "esv.ad.creds",
      description: undefined,
      encoding: "generic",
      lastChangeDate: undefined,
      lastChangedBy: undefined,
      loaded: true,
      activeVersion: "1",
      loadedVersion: "1",
      useInPlaceholders: true,
    });
  });

  it("getScriptByName queries by name and returns the first mapped result (or null)", async () => {
    const source = "exports.help = function(){};";
    // First call — hit.
    fake.enqueueGet({
      result: [
        {
          _id: "s-lib",
          name: "helpers",
          language: "JAVASCRIPT",
          script: Buffer.from(source, "utf8").toString("base64"),
        },
      ],
      pagedResultsCookie: null,
    });
    const hit = await client.getScriptByName("alpha", "helpers");
    expect(fake.calls[0].url).toContain("/am/json/realms/root/realms/alpha/scripts?");
    // URLSearchParams encodes the quotes; either `%22` or `+` between tokens is OK.
    expect(fake.calls[0].url).toContain("name+eq+%22helpers%22");
    expect(fake.calls[0].apiVersion).toBe("protocol=2.0,resource=1.0");
    expect(hit).toEqual({ id: "s-lib", name: "helpers", language: "JAVASCRIPT", body: source });

    // Second call — miss (empty result array).
    fake.enqueueGet({ result: [], pagedResultsCookie: null });
    const miss = await client.getScriptByName("alpha", "nope");
    expect(miss).toBeNull();
  });

  it("short-circuits Tier-B/C methods when capabilities are disabled — no HTTP (D41 Slice 3)", async () => {
    const offline = makePaicClient({
      http: fake.http,
      log: makeFakeLogger(),
      capabilities: { themes: false, emailTemplates: false, esvs: false },
    });

    expect(await offline.getTheme("alpha", "t-1")).toBeNull();
    expect(await offline.listThemes("alpha")).toEqual([]);
    expect(await offline.getEmailTemplate("welcome")).toBeNull();
    expect(await offline.getEsv("esv.x.y")).toBeNull();
    expect(await offline.listVariables("alpha")).toEqual([]);
    expect(await offline.listSecrets("alpha")).toEqual([]);

    // None of the short-circuited methods touched the HTTP layer.
    expect(fake.calls).toHaveLength(0);
  });

  it("prefixes AM URLs with an injected amPath (D41 Slice 3)", async () => {
    const onprem = makePaicClient({ http: fake.http, log: makeFakeLogger(), amPath: "/openam" });
    fake.enqueueGet({ result: [], pagedResultsCookie: null });

    await onprem.listJourneys(""); // realm "" → root

    expect(fake.calls[0].url).toBe(
      "/openam/json/realms/root/realm-config/authentication/authenticationtrees/trees?_queryFilter=true",
    );
  });
});
