import { describe, expect, it } from "vitest";
import { buildImportConfirmDetail } from "./confirm";

describe("buildImportConfirmDetail", () => {
  it("names the target + joins create/overwrite; omits keep when 0", () => {
    const d = buildImportConfirmDetail({ host: "h", realm: "alpha", create: 2, overwrite: 1 });
    expect(d).toContain("Import to h / realm alpha — create 2 · overwrite 1.");
    expect(d).not.toContain("keep");
    expect(d).toContain("not transactional and cannot be undone");
  });

  it("includes keep when > 0 (journey path)", () => {
    const d = buildImportConfirmDetail({ host: "h", realm: "r", create: 1, overwrite: 0, keep: 3 });
    expect(d).toContain("create 1 · overwrite 0 · keep 3.");
  });

  it("appends the error, ESV, and missing-deps notes when present", () => {
    const d = buildImportConfirmDetail({
      host: "h",
      realm: "r",
      create: 1,
      overwrite: 0,
      errorN: 2,
      hasEsv: true,
      missingNote: " ⚠ 1 referenced dependency missing.",
    });
    expect(d).toContain("2 component(s) couldn't be checked");
    expect(d).toContain("ESV changes require a separate Apply step");
    expect(d).toContain("⚠ 1 referenced dependency missing.");
  });

  it("omits all optional notes when not supplied", () => {
    const d = buildImportConfirmDetail({ host: "h", realm: "r", create: 1, overwrite: 1 });
    expect(d).not.toContain("couldn't be checked");
    expect(d).not.toContain("ESV changes");
  });
});
