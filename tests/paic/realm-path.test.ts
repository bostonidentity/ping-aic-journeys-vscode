import { describe, expect, it } from "vitest";
import { getRealmPath } from "@/paic/realm-path";

describe("getRealmPath", () => {
  it("returns the root realm for an empty string", () => {
    expect(getRealmPath("")).toBe("/realms/root");
  });

  it("returns the root realm for a bare slash", () => {
    expect(getRealmPath("/")).toBe("/realms/root");
  });

  it("strips a leading slash and prefixes /realms/root/realms/", () => {
    expect(getRealmPath("/alpha")).toBe("/realms/root/realms/alpha");
  });

  it("prefixes /realms/root/realms/ to a single realm", () => {
    expect(getRealmPath("alpha")).toBe("/realms/root/realms/alpha");
  });

  it("recurses /realms/ between segments for sub-realms", () => {
    expect(getRealmPath("alpha/customers")).toBe("/realms/root/realms/alpha/realms/customers");
  });
});
