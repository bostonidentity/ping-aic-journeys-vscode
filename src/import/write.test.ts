import { describe, expect, it } from "vitest";
import {
  emailTemplateName,
  idpNeedsSecret,
  toEmailWrite,
  toIdpWrite,
  toSecretWrite,
  toThemeWrite,
  toVariableWrite,
} from "./write";

const decode = (b64: string): string => Buffer.from(b64, "base64").toString("utf8");

describe("write transforms", () => {
  it("toEmailWrite strips _id and extracts the bare name from the prefix", () => {
    const { name, body } = toEmailWrite({ _id: "emailTemplate/welcome", subject: { en: "Hi" } });
    expect(name).toBe("welcome");
    expect(body).toEqual({ subject: { en: "Hi" } });
  });

  it("toIdpWrite keeps _id, drops _type, sets the supplied secret", () => {
    const { typeId, id, body } = toIdpWrite(
      { _id: "g", _type: { _id: "oidcConfig" }, clientId: "c", clientSecret: null },
      "s3cret",
    );
    expect(typeId).toBe("oidcConfig");
    expect(id).toBe("g");
    expect(body._id).toBe("g");
    expect(body._type).toBeUndefined();
    expect(body.clientSecret).toBe("s3cret");
  });

  it("toIdpWrite leaves clientSecret untouched when none is supplied", () => {
    const { body } = toIdpWrite({ _id: "g", _type: { _id: "x" }, clientSecret: null }, undefined);
    expect(body.clientSecret).toBeNull();
  });

  it("toThemeWrite drops linkedTrees, keeps content + _id", () => {
    const out = toThemeWrite({ _id: "t", linkedTrees: ["A"], backgroundColor: "#1" });
    expect(out.linkedTrees).toBeUndefined();
    expect(out.backgroundColor).toBe("#1");
    expect(out._id).toBe("t");
  });

  it("idpNeedsSecret is true only when a clientSecret key is present", () => {
    expect(idpNeedsSecret({ clientSecret: null })).toBe(true);
    expect(idpNeedsSecret({ clientId: "c" })).toBe(false);
  });

  it("emailTemplateName strips the prefix and is a no-op without it", () => {
    expect(emailTemplateName("emailTemplate/welcome")).toBe("welcome");
    expect(emailTemplateName("welcome")).toBe("welcome");
  });
});

describe("ESV write transforms", () => {
  it("toVariableWrite keeps writable fields, drops server fields + _id", () => {
    const out = toVariableWrite({
      _id: "esv-x",
      valueBase64: "dmFs",
      expressionType: "string",
      description: "d",
      lastChangeDate: "2026",
      lastChangedBy: "sa",
      loaded: false,
    });
    expect(out).toEqual({ valueBase64: "dmFs", expressionType: "string", description: "d" });
  });

  it("toSecretWrite base64-encodes the plaintext exactly once + keeps encoding", () => {
    const out = toSecretWrite(
      { _id: "esv-s", encoding: "generic", useInPlaceholders: true, loaded: false },
      "s3cret-value",
    );
    expect(decode(out.valueBase64 as string)).toBe("s3cret-value"); // single encode round-trips
    expect(out.encoding).toBe("generic");
    expect(out.useInPlaceholders).toBe(true);
    expect(out._id).toBeUndefined();
    expect(out.loaded).toBeUndefined();
  });
});
