import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import { SocialIdpNode } from "@/views/nodes/social-idp";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

describe("SocialIdpNode", () => {
  it("constructor sets uid + contextValue + leaf state; loadChildren returns empty", async () => {
    const node = new SocialIdpNode(
      "h.example.com",
      "alpha",
      "google-oidc",
      makeFakeCache(makeFakePaicClient({})),
      makeFakeLogger(),
    );
    expect(node.uid).toBe("social-idp:h.example.com:alpha:google-oidc");
    expect(node.id).toBe(node.uid);
    expect(node.contextValue).toBe("socialIdp");
    expect(await node.getChildren()).toEqual([]);
  });
});
