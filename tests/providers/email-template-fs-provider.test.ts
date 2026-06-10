import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import {
  EMAIL_TEMPLATE_URI_SCHEME,
  makeEmailTemplateUri,
  PaicEmailTemplateFileSystemProvider,
  parseEmailTemplateUri,
} from "@/providers/email-template-fs-provider";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../views/fakes";

const HOST = "openam-tenant.example.forgeblocks.com";

function makeProvider(emailTemplate?: { name: string; message: Record<string, string> }) {
  const tpl = emailTemplate ?? {
    name: "Welcome",
    message: { en: "<h1>hi</h1>", fr: "<h1>salut</h1>" },
  };
  const client = makeFakePaicClient({
    emailTemplatesByName: { [tpl.name]: { ...tpl, enabled: true } },
  });
  return new PaicEmailTemplateFileSystemProvider(makeFakeCache(client), makeFakeLogger());
}

describe("parseEmailTemplateUri", () => {
  it("extracts host / name / locale from a canonical URI", () => {
    const uri = makeEmailTemplateUri(HOST, "Welcome", "en");
    expect(parseEmailTemplateUri(uri)).toEqual({ host: HOST, name: "Welcome", locale: "en" });
  });

  it("round-trips a full-URL (on-prem) host through the authority (B-03)", () => {
    const ONPREM = "http://openam.example.com:8080/am";
    const uri = makeEmailTemplateUri(ONPREM, "Welcome", "en");
    expect(parseEmailTemplateUri(uri)).toEqual({ host: ONPREM, name: "Welcome", locale: "en" });
  });

  it("throws on wrong scheme", () => {
    const uri = vscode.Uri.parse(`paic-script://${HOST}/alpha/s.js`);
    expect(() => parseEmailTemplateUri(uri)).toThrow(/Not a paic-email-template URI/);
  });
});

describe("makeEmailTemplateUri", () => {
  it("builds a canonical URI ending in .html", () => {
    const uri = makeEmailTemplateUri(HOST, "Welcome", "en");
    expect(uri.scheme).toBe(EMAIL_TEMPLATE_URI_SCHEME);
    expect(uri.authority).toBe(HOST);
    expect(uri.path).toBe("/Welcome/en.html");
  });
});

describe("PaicEmailTemplateFileSystemProvider — read paths", () => {
  it("readFile returns the message[locale] body bytes (UTF-8)", async () => {
    const provider = makeProvider();
    const bytes = await provider.readFile(makeEmailTemplateUri(HOST, "Welcome", "en"));
    expect(new TextDecoder().decode(bytes)).toBe("<h1>hi</h1>");
  });

  it("stat returns a read-only file with the right byte size", async () => {
    const provider = makeProvider();
    const stat = await provider.stat(makeEmailTemplateUri(HOST, "Welcome", "fr"));
    expect(stat.type).toBe(vscode.FileType.File);
    expect(stat.permissions).toBe(vscode.FilePermission.Readonly);
    expect(stat.size).toBe(Buffer.byteLength("<h1>salut</h1>", "utf8"));
  });

  it("stat + readFile in quick succession only fetches once (dedupe cache)", async () => {
    const tpl = { name: "Welcome", message: { en: "<h1>once</h1>" } };
    const client = makeFakePaicClient({
      emailTemplatesByName: { [tpl.name]: { ...tpl, enabled: true } },
    });
    const provider = new PaicEmailTemplateFileSystemProvider(
      makeFakeCache(client),
      makeFakeLogger(),
    );
    const uri = makeEmailTemplateUri(HOST, "Welcome", "en");
    await provider.stat(uri);
    await provider.readFile(uri);
    expect((client.getEmailTemplate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("throws FileNotFound when the template doesn't exist in the tenant", async () => {
    const client = makeFakePaicClient({ emailTemplatesByName: {} });
    const provider = new PaicEmailTemplateFileSystemProvider(
      makeFakeCache(client),
      makeFakeLogger(),
    );
    await expect(provider.readFile(makeEmailTemplateUri(HOST, "Missing", "en"))).rejects.toThrow();
  });

  it("throws FileNotFound when the locale is missing on a real template", async () => {
    const provider = makeProvider({ name: "Welcome", message: { en: "<h1>hi</h1>" } });
    await expect(provider.readFile(makeEmailTemplateUri(HOST, "Welcome", "es"))).rejects.toThrow();
  });
});

describe("PaicEmailTemplateFileSystemProvider — mutating methods all refuse", () => {
  it("writeFile / delete / rename / createDirectory all throw NoPermissions", () => {
    const provider = makeProvider();
    const uri = makeEmailTemplateUri(HOST, "Welcome", "en");
    expect(() => provider.writeFile(uri)).toThrow(/NoPermissions|permission/i);
    expect(() => provider.delete(uri)).toThrow(/NoPermissions|permission/i);
    expect(() => provider.rename(uri)).toThrow(/NoPermissions|permission/i);
    expect(() => provider.createDirectory(uri)).toThrow(/NoPermissions|permission/i);
    expect(() => provider.readDirectory()).toThrow(/NoPermissions|permission/i);
  });

  it("watch returns a no-op disposable", () => {
    const provider = makeProvider();
    const d = provider.watch();
    expect(typeof d.dispose).toBe("function");
    d.dispose(); // no throw
  });
});
