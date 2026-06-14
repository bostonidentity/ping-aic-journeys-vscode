import { describe, expect, it, vi } from "vitest";
import { PaicError } from "../paic/errors";
import { putWithRetry, stripInvalidAttributes } from "./write-retry";

const g2 = (validAttributes: string[]) =>
  new PaicError("Invalid attribute specified.", {
    status: 400,
    description: "Invalid attribute specified.",
    detail: { validAttributes },
  });

describe("stripInvalidAttributes", () => {
  it("keeps validAttributes ∪ {_id} and drops the rest", () => {
    expect(
      stripInvalidAttributes(g2(["name", "config"]), { _id: "x", name: "n", config: 1, junk: 2 }),
    ).toEqual({ _id: "x", name: "n", config: 1 });
  });

  it("returns null for a non-G2 error (other message / non-PaicError / non-400)", () => {
    expect(
      stripInvalidAttributes(new PaicError("nope", { status: 400, description: "other" }), {
        a: 1,
      }),
    ).toBeNull();
    expect(stripInvalidAttributes(new Error("x"), { a: 1 })).toBeNull();
    expect(stripInvalidAttributes(new PaicError("x", { status: 500 }), { a: 1 })).toBeNull();
  });
});

describe("putWithRetry", () => {
  it("returns the outcome on first success (no retry)", async () => {
    const put = vi.fn(() => Promise.resolve("created" as const));
    expect(await putWithRetry(put, { a: 1 })).toBe("created");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("retries once with the stripped body on a G2 400", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(g2(["_id", "name"]))
      .mockResolvedValue("overwritten");
    const r = await putWithRetry(put, { _id: "x", name: "n", junk: 9 });
    expect(r).toBe("overwritten");
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][0]).toEqual({ _id: "x", name: "n" }); // junk stripped
  });

  it("rethrows a non-G2 error without retrying", async () => {
    const err = new PaicError("boom", { status: 400, description: "other" });
    const put = vi.fn(() => Promise.reject(err));
    await expect(putWithRetry(put, { a: 1 })).rejects.toBe(err);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
