import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { beforeEach, describe, expect, it } from "vitest";
import type { Script } from "@/domain/types";
import { EsvNode } from "@/views/nodes/esv";
import { LibraryScriptNode } from "@/views/nodes/library-script";
import { ScriptNode } from "@/views/nodes/script";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

const HOST = "h.example.com";
const REALM = "alpha";

function script(over: Partial<Script>): Script {
  return { id: "s-1", name: "Script1", language: "JAVASCRIPT", body: "", ...over };
}

describe("ScriptNode expansion", () => {
  let getScriptCount: number;

  beforeEach(() => {
    getScriptCount = 0;
  });

  function makeNode(body: string) {
    const client = makeFakePaicClient({
      scriptsByKey: { [`${REALM}:s-1`]: script({ id: "s-1", body }) },
    });
    const origGetScript = client.getScript;
    client.getScript = vi.fn((r: string, id: string) => {
      getScriptCount++;
      return origGetScript(r, id);
    });
    return {
      client,
      node: new ScriptNode(HOST, REALM, "s-1", makeFakeCache(client), makeFakeLogger()),
    };
  }

  it("emits a LibraryScriptNode for a require('helpers') in the body", async () => {
    const client = makeFakePaicClient({
      scriptsByKey: {
        [`${REALM}:s-1`]: script({ id: "s-1", body: `var h = require('helpers');` }),
      },
      scriptsByName: {
        [`${REALM}:byName:helpers`]: script({
          id: "s-lib-helpers",
          name: "helpers",
          body: "exports.go = function(){};",
        }),
      },
    });
    const node = new ScriptNode(HOST, REALM, "s-1", makeFakeCache(client), makeFakeLogger());
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(LibraryScriptNode);
    const lib = kids[0] as LibraryScriptNode;
    expect(lib.name).toBe("helpers");
    expect(lib.scriptId).toBe("s-lib-helpers");
  });

  it("emits an EsvNode for an &{esv.X} reference in the body", async () => {
    const { node } = makeNode(`var url = "&{esv.PUBLIC_URL}";`);
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(EsvNode);
    expect((kids[0] as EsvNode).name).toBe("PUBLIC_URL");
  });

  it("dedupes both kinds: one library + one ESV from a body that references each twice", async () => {
    const client = makeFakePaicClient({
      scriptsByKey: {
        [`${REALM}:s-1`]: script({
          id: "s-1",
          body: `require('crypto'); require("crypto"); var a = "&{esv.X}"; var b = systemEnv.X;`,
        }),
      },
      scriptsByName: {
        [`${REALM}:byName:crypto`]: script({ id: "s-lib-crypto", name: "crypto", body: "" }),
      },
    });
    const node = new ScriptNode(HOST, REALM, "s-1", makeFakeCache(client), makeFakeLogger());
    const kids = await node.getChildren();
    expect(kids).toHaveLength(2);
    expect(kids.filter((k) => k instanceof LibraryScriptNode)).toHaveLength(1);
    expect(kids.filter((k) => k instanceof EsvNode)).toHaveLength(1);
  });

  it("refresh() clears the cached body — next getChildren() re-fetches via getScript", async () => {
    const { node } = makeNode(`var x = 1;`);
    await node.getChildren();
    await node.getChildren();
    expect(getScriptCount).toBe(1);
    node.refresh();
    await node.getChildren();
    expect(getScriptCount).toBe(2);
  });
});
