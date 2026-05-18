import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import type { Script } from "@/domain/types";
import { MessageNode } from "@/views/nodes/base";
import { LibraryScriptNode } from "@/views/nodes/library-script";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

const HOST = "h.example.com";
const REALM = "alpha";

function script(over: Partial<Script>): Script {
  return { id: "lib-id", name: "lib", language: "JAVASCRIPT", body: "", ...over };
}

describe("LibraryScriptNode", () => {
  it("recurses — a library that require()s another emits a child LibraryScriptNode", async () => {
    const client = makeFakePaicClient({
      scriptsByName: {
        [`${REALM}:byName:inner`]: script({ id: "inner-id", name: "inner", body: "// leaf" }),
      },
    });
    const node = new LibraryScriptNode(
      HOST,
      REALM,
      "outer-id",
      "outer",
      `require('inner');`,
      makeFakeCache(client),
      makeFakeLogger(),
      ["parent-script"],
    );
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(LibraryScriptNode);
    expect((kids[0] as LibraryScriptNode).name).toBe("inner");
  });

  it("cycle: a library whose body require()s itself emits a [cycle: <name>] MessageNode", async () => {
    const client = makeFakePaicClient({});
    // `visited` already contains "selfish"; the expander sees the require()
    // and emits a cycle MessageNode without calling getScriptByName.
    const node = new LibraryScriptNode(
      HOST,
      REALM,
      "self-id",
      "selfish",
      `require('selfish');`,
      makeFakeCache(client),
      makeFakeLogger(),
      ["parent-script", "selfish"],
    );
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(MessageNode);
    expect(kids[0].label).toBe("[cycle: selfish]");
    expect((client.getScriptByName as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("missing: require('does-not-exist') emits a [missing library: ...] MessageNode", async () => {
    const client = makeFakePaicClient({});
    const node = new LibraryScriptNode(
      HOST,
      REALM,
      "x-id",
      "x",
      `require('does-not-exist');`,
      makeFakeCache(client),
      makeFakeLogger(),
      ["parent-script"],
    );
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(MessageNode);
    expect(kids[0].label).toBe("[missing library: does-not-exist]");
  });
});
