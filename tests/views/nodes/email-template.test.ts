import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import { EmailTemplateNode } from "@/views/nodes/email-template";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

describe("EmailTemplateNode", () => {
  it("constructor sets uid + contextValue + leaf state; loadChildren returns empty", async () => {
    const node = new EmailTemplateNode(
      "h.example.com",
      "alpha",
      "PasswordResetMail",
      makeFakeCache(makeFakePaicClient({})),
      makeFakeLogger(),
    );
    expect(node.uid).toBe("email-template:h.example.com:alpha:PasswordResetMail");
    expect(node.id).toBe(node.uid);
    expect(node.contextValue).toBe("emailTemplate");
    expect(await node.getChildren()).toEqual([]);
  });
});
