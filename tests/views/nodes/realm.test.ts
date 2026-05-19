import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import type { Journey } from "@/domain/types";
import { MessageNode } from "@/views/nodes/base";
import { JourneyNode } from "@/views/nodes/journey";
import { RealmNode } from "@/views/nodes/realm";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

const REALM = { name: "alpha", active: true, parentPath: "/", isRoot: false };
const HOST = "h.example.com";

function makeJourney(id: string): Journey {
  return { id, enabled: true, entryNodeId: "e", nodes: {} };
}

describe("RealmNode", () => {
  it("getChildren returns one JourneyNode per journey", async () => {
    const client = makeFakePaicClient({
      journeysByRealm: { alpha: [makeJourney("Login"), makeJourney("Registration")] },
    });
    const node = new RealmNode(HOST, REALM, makeFakeCache(client), makeFakeLogger());
    const kids = await node.getChildren();
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBeInstanceOf(JourneyNode);
    expect((kids[0] as JourneyNode).journey.id).toBe("Login");
    expect((kids[1] as JourneyNode).journey.id).toBe("Registration");
  });

  it("empty journey list emits a MessageNode", async () => {
    const client = makeFakePaicClient({ journeysByRealm: { alpha: [] } });
    const node = new RealmNode(HOST, REALM, makeFakeCache(client), makeFakeLogger());
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(MessageNode);
    expect(kids[0].label).toBe("No journeys in this realm");
  });
});
