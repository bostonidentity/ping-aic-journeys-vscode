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
});
