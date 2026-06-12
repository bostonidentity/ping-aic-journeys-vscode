import { describe, expect, it } from "vitest";
import type { Connection } from "@/domain/types";
import { buildExportMeta } from "@/export/meta";

const NOW = "2026-06-11T00:00:00.000Z";

describe("buildExportMeta", () => {
  it("builds meta for a paic connection (connectionType paic, exportedBy = saId)", () => {
    const conn: Connection = {
      kind: "paic",
      host: "openam-tenant.example.forgeblocks.com",
      saId: "00000000-0000-0000-0000-000000000000",
    };
    expect(buildExportMeta(conn, "alpha", "0.2.0", NOW)).toEqual({
      bundleSchemaVersion: "1.0",
      origin: "openam-tenant.example.forgeblocks.com",
      connectionType: "paic",
      realm: "alpha",
      exportedBy: "00000000-0000-0000-0000-000000000000",
      exportDate: NOW,
      exportTool: "paic-journeys-vscode",
      exportToolVersion: "0.2.0",
    });
  });

  it("maps an onprem connection to am-onprem with username as exportedBy", () => {
    const conn: Connection = {
      kind: "onprem",
      host: "http://openam.example.com:8080",
      username: "amadmin",
    };
    const meta = buildExportMeta(conn, "/", "0.2.0", NOW);
    expect(meta.connectionType).toBe("am-onprem");
    expect(meta.exportedBy).toBe("amadmin");
    expect(meta.realm).toBe("/");
  });
});
