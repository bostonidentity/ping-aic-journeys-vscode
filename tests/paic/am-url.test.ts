import { describe, expect, it } from "vitest";
import { amContextPath, amOrigin } from "@/paic/am-url";

describe("amOrigin", () => {
  it("prepends https to a bare hostname", () => {
    expect(amOrigin("openam.example.com")).toBe("https://openam.example.com");
  });

  it("keeps an explicit http scheme and port", () => {
    expect(amOrigin("http://openam.example.com:8080")).toBe("http://openam.example.com:8080");
  });

  it("strips any path component (origin only)", () => {
    expect(amOrigin("http://openam.example.com:8080/openam")).toBe(
      "http://openam.example.com:8080",
    );
  });
});

describe("amContextPath", () => {
  it("defaults to /am when the URL has no path", () => {
    expect(amContextPath("http://openam.example.com:8080")).toBe("/am");
    expect(amContextPath("openam.example.com")).toBe("/am");
  });

  it("returns the path component when present", () => {
    expect(amContextPath("http://openam.example.com:8080/openam")).toBe("/openam");
  });

  it("strips a trailing slash", () => {
    expect(amContextPath("http://openam.example.com:8080/am/")).toBe("/am");
  });

  it("honours a custom fallback", () => {
    expect(amContextPath("http://openam.example.com:8080", "/sso")).toBe("/sso");
  });
});
