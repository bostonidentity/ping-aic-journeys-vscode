import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

import { beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import type { PaicClient } from "@/paic/client";
import {
  makeScriptUri,
  PaicScriptFileSystemProvider,
  parseScriptUri,
  SCRIPT_URI_SCHEME,
} from "@/providers/script-fs-provider";
import type { ClientCache } from "@/tenants/client-cache";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../views/fakes";

const HOST = "openam-tenant.example.forgeblocks.com";
const REALM = "alpha";

function makeUri(host = HOST, realm = REALM, scriptId = "s-1", ext = "js"): vscode.Uri {
  return vscode.Uri.parse(`${SCRIPT_URI_SCHEME}://${host}/${realm}/${scriptId}.${ext}`);
}

function makeProvider(opts?: {
  cache?: ClientCache;
  client?: PaicClient;
}): PaicScriptFileSystemProvider {
  const client =
    opts?.client ??
    makeFakePaicClient({
      scriptsByKey: {
        [`${REALM}:s-1`]: { id: "s-1", name: "Auth", language: "JAVASCRIPT", body: "return true" },
      },
    });
  const cache = opts?.cache ?? makeFakeCache(client);
  return new PaicScriptFileSystemProvider(cache, makeFakeLogger());
}

describe("parseScriptUri", () => {
  it("extracts host / realm / scriptId / ext from a canonical URI", () => {
    const uri = makeUri();
    expect(parseScriptUri(uri)).toEqual({
      host: HOST,
      realm: "alpha",
      scriptId: "s-1",
      ext: "js",
    });
  });

  it("supports sub-realm paths in the URI", () => {
    const uri = vscode.Uri.parse(`${SCRIPT_URI_SCHEME}://${HOST}/alpha/customers/s.js`);
    expect(parseScriptUri(uri)).toEqual({
      host: HOST,
      realm: "alpha/customers",
      scriptId: "s",
      ext: "js",
    });
  });

  it("throws on wrong scheme", () => {
    expect(() => parseScriptUri(vscode.Uri.parse("file:///tmp/x.js"))).toThrow(/Not a paic-script/);
  });

  it("throws on malformed URI (no filename at all)", () => {
    // A single segment is now the root realm (see below), so the malformed case
    // is a path-less URI.
    expect(() => parseScriptUri(vscode.Uri.parse(`${SCRIPT_URI_SCHEME}://h/`))).toThrow(
      /Malformed/,
    );
  });

  it("treats a single path segment as the root realm (on-prem AM, D41)", () => {
    // makeScriptUri(host, "", id) emits `host//id.js`; the empty realm collapses.
    expect(parseScriptUri(vscode.Uri.parse(`${SCRIPT_URI_SCHEME}://${HOST}//s-1.js`))).toEqual({
      host: HOST,
      realm: "",
      scriptId: "s-1",
      ext: "js",
    });
    // Same result whether the path arrives with one or two leading slashes.
    expect(parseScriptUri(vscode.Uri.parse(`${SCRIPT_URI_SCHEME}://${HOST}/s-1.js`))).toEqual({
      host: HOST,
      realm: "",
      scriptId: "s-1",
      ext: "js",
    });
  });

  it("round-trips a root-realm script through makeScriptUri → parseScriptUri", () => {
    const parsed = parseScriptUri(makeScriptUri(HOST, "", "s-1"));
    expect(parsed.realm).toBe("");
    expect(parsed.scriptId).toBe("s-1");
    expect(parsed.host).toBe(HOST);
  });

  it("round-trips a full-URL (on-prem) host through the authority (B-02)", () => {
    const ONPREM = "http://openam.example.com:8080/am";
    expect(parseScriptUri(makeScriptUri(ONPREM, "alpha", "s-1"))).toEqual({
      host: ONPREM,
      realm: "alpha",
      scriptId: "s-1",
      ext: "js",
    });
  });

  it("round-trips a full-URL on-prem host with the root realm (B-01 + B-02)", () => {
    const ONPREM = "http://openam.example.com:8080/am";
    const parsed = parseScriptUri(makeScriptUri(ONPREM, "", "s-1"));
    expect(parsed.host).toBe(ONPREM);
    expect(parsed.realm).toBe("");
    expect(parsed.scriptId).toBe("s-1");
  });
});

describe("makeScriptUri", () => {
  it("produces a .js URI by default and for JAVASCRIPT", () => {
    expect(makeScriptUri(HOST, REALM, "s-1").toString()).toBe(
      `${SCRIPT_URI_SCHEME}://${HOST}/${REALM}/s-1.js`,
    );
    expect(makeScriptUri(HOST, REALM, "s-1", "JAVASCRIPT").toString()).toBe(
      `${SCRIPT_URI_SCHEME}://${HOST}/${REALM}/s-1.js`,
    );
  });

  it("produces a .groovy URI for GROOVY language", () => {
    expect(makeScriptUri(HOST, REALM, "s-1", "GROOVY").toString()).toBe(
      `${SCRIPT_URI_SCHEME}://${HOST}/${REALM}/s-1.groovy`,
    );
  });
});

describe("PaicScriptFileSystemProvider", () => {
  let getScriptCount: number;
  let client: PaicClient;
  let provider: PaicScriptFileSystemProvider;

  beforeEach(() => {
    getScriptCount = 0;
    client = makeFakePaicClient({
      scriptsByKey: {
        [`${REALM}:s-1`]: { id: "s-1", name: "Auth", language: "JAVASCRIPT", body: "return 42" },
      },
    });
    const orig = client.getScript;
    client.getScript = vi.fn((realm: string, id: string) => {
      getScriptCount++;
      return orig(realm, id);
    });
    provider = makeProvider({ client });
  });

  it("readFile returns the script body bytes", async () => {
    const bytes = await provider.readFile(makeUri());
    expect(new TextDecoder().decode(bytes)).toBe("return 42");
  });

  it("stat returns FileType.File with FilePermission.Readonly and correct byte size", async () => {
    const stat = await provider.stat(makeUri());
    expect(stat.type).toBe(vscode.FileType.File);
    expect(stat.permissions).toBe(vscode.FilePermission.Readonly);
    expect(stat.size).toBe(Buffer.byteLength("return 42", "utf8"));
  });

  it("stat then readFile makes a single getScript call (dedupe cache hit)", async () => {
    await provider.stat(makeUri());
    await provider.readFile(makeUri());
    expect(getScriptCount).toBe(1);
  });

  it("writeFile throws NoPermissions", () => {
    expect(() => provider.writeFile(makeUri())).toThrow(/NoPermissions/);
  });

  it("delete / rename / readDirectory / createDirectory throw NoPermissions", () => {
    expect(() => provider.delete(makeUri())).toThrow(/NoPermissions/);
    expect(() => provider.rename(makeUri())).toThrow(/NoPermissions/);
    expect(() => provider.readDirectory()).toThrow(/NoPermissions/);
    expect(() => provider.createDirectory(makeUri())).toThrow(/NoPermissions/);
  });

  it("missing script → readFile throws FileNotFound", async () => {
    // The fake client rejects for keys with no fixture.
    await expect(provider.readFile(makeUri(HOST, REALM, "missing"))).rejects.toThrow(
      /FileNotFound/,
    );
  });

  it("unavailable client → readFile throws Unavailable", async () => {
    const failingCache: ClientCache = {
      get: vi.fn(() => Promise.reject(new Error("no credentials"))),
      drop: vi.fn(),
      dispose: vi.fn(),
    };
    const p = new PaicScriptFileSystemProvider(failingCache, makeFakeLogger());
    await expect(p.readFile(makeUri())).rejects.toThrow(/Unavailable/);
  });

  it("watch returns a disposable with a no-op dispose", () => {
    const disp = provider.watch();
    expect(typeof disp.dispose).toBe("function");
    expect(() => disp.dispose()).not.toThrow();
  });

  it("requests the FULL on-prem URL host from the cache, not a truncated 'http:' (B-02)", async () => {
    const ONPREM = "http://openam.example.com:8080/am";
    let seenHost = "";
    const urlHostClient = makeFakePaicClient({
      scriptsByKey: {
        "alpha:s-1": { id: "s-1", name: "Auth", language: "JAVASCRIPT", body: "return 7" },
      },
    });
    const recordingCache: ClientCache = {
      get: vi.fn((h: string) => {
        seenHost = h;
        return Promise.resolve(urlHostClient);
      }),
      drop: vi.fn(),
      dispose: vi.fn(),
    };
    const p = new PaicScriptFileSystemProvider(recordingCache, makeFakeLogger());

    const bytes = await p.readFile(makeScriptUri(ONPREM, "alpha", "s-1"));

    expect(seenHost).toBe(ONPREM); // was "http:" before B-02
    expect(new TextDecoder().decode(bytes)).toBe("return 7");
  });

  it("reads a root-realm script (on-prem AM) — getScript called with realm=''", async () => {
    const calls: Array<{ realm: string; id: string }> = [];
    const rootClient = makeFakePaicClient({
      scriptsByKey: {
        ":s-1": { id: "s-1", name: "Root", language: "JAVASCRIPT", body: "return 1" },
      },
    });
    const orig = rootClient.getScript;
    rootClient.getScript = vi.fn((realm: string, id: string) => {
      calls.push({ realm, id });
      return orig(realm, id);
    });
    const p = new PaicScriptFileSystemProvider(makeFakeCache(rootClient), makeFakeLogger());

    const bytes = await p.readFile(makeScriptUri(HOST, "", "s-1"));

    expect(new TextDecoder().decode(bytes)).toBe("return 1");
    expect(calls).toEqual([{ realm: "", id: "s-1" }]);
  });
});
