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
      { name: "alpha", active: true, parentPath: "/" },
      { name: "beta", active: false, parentPath: "/" },
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
    fake.enqueueGet({
      realms: {
        alpha: {
          themes: [
            { _id: "theme-1", name: "Default" },
            { _id: "theme-2", name: "Custom" },
          ],
        },
        beta: { themes: [{ _id: "theme-3", name: "Other" }] },
      },
    });
    const found = await client.getTheme("alpha", "theme-2");
    expect(fake.calls[0].url).toBe("/openidm/config/ui/themerealm");
    expect(found).toEqual({ id: "theme-2", name: "Custom", realm: "alpha" });

    fake.enqueueGet({
      realms: { alpha: { themes: [{ _id: "theme-1", name: "Default" }] } },
    });
    const miss = await client.getTheme("alpha", "no-such-theme");
    expect(miss).toBeNull();
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
});
