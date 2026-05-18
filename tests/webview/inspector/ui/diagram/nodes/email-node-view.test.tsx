// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmailNodeView } from "@/webview/inspector/ui/diagram/nodes/EmailNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("EmailNodeView", () => {
  it("renders 'Email Suspend' kind + template hint when EmailSuspendNode", () => {
    render(
      <EmailNodeView
        id="n1"
        type="EmailSuspendNode"
        data={{
          displayName: "Suspend until verified",
          nodeType: "EmailSuspendNode",
          info: { kind: "emailTemplate", emailTemplateName: "Welcome" },
          isEntry: false,
        }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText("Email Suspend")).toBeTruthy();
    expect(screen.getByText(/Template: Welcome/)).toBeTruthy();
  });

  it("renders 'Email Template' kind label when EmailTemplateNode", () => {
    render(
      <EmailNodeView
        id="n1"
        type="EmailTemplateNode"
        data={{
          displayName: "Send mail",
          nodeType: "EmailTemplateNode",
          info: { kind: "emailTemplate", emailTemplateName: "PasswordReset" },
          isEntry: false,
        }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText("Email Template")).toBeTruthy();
    expect(screen.getByText(/Template: PasswordReset/)).toBeTruthy();
  });
});
