import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LoggerOptions, makeLogger } from "@/util/logger";

// In-memory fake of vscode.LogOutputChannel. Records every call to
// trace/debug/info/warn/error so tests can assert routing + content.
interface FakeChannel {
  trace: (m: string) => void;
  debug: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
  calls: Array<{ level: string; msg: string }>;
}

function makeFakeChannel(): FakeChannel {
  const calls: FakeChannel["calls"] = [];
  return {
    calls,
    trace: (m) => calls.push({ level: "trace", msg: m }),
    debug: (m) => calls.push({ level: "debug", msg: m }),
    info: (m) => calls.push({ level: "info", msg: m }),
    warn: (m) => calls.push({ level: "warn", msg: m }),
    error: (m) => calls.push({ level: "error", msg: m }),
  };
}

let tmpDir: string;
let channel: FakeChannel;

function baseOpts(overrides: Partial<LoggerOptions> = {}): LoggerOptions {
  return {
    storageUri: { fsPath: tmpDir } as LoggerOptions["storageUri"],
    version: "0.0.1-test",
    level: "trace",
    fileEnabled: true,
    channel: channel as unknown as LoggerOptions["channel"],
    ...overrides,
  };
}

function readNdjson(): Array<Record<string, unknown>> {
  const filepath = path.join(tmpDir, "logs", "paic-journeys.ndjson");
  if (!fs.existsSync(filepath)) return [];
  return fs
    .readFileSync(filepath, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// pino writes via process.nextTick; give async writes time to flush before reading the file.
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paic-logger-"));
  channel = makeFakeChannel();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("logger", () => {
  it("emits a single NDJSON line per log call to the file sink", async () => {
    const log = makeLogger(baseOpts());
    log.info({ a: 1 }, "hello");
    await flush();

    const lines = readNdjson();
    expect(lines).toHaveLength(1);
    const r = lines[0];
    expect(r.service).toBe("paic-journeys");
    expect(r.version).toBe("0.0.1-test");
    expect(r.level).toBe(30); // pino info
    expect(r.msg).toBe("hello");
    expect(r.a).toBe(1);
    expect(typeof r.time).toBe("string");
    expect(r.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("routes to the channel adapter with the matching method", async () => {
    const log = makeLogger(baseOpts());
    log.info({ a: 1 }, "hello");
    await flush();

    expect(channel.calls).toHaveLength(1);
    expect(channel.calls[0].level).toBe("info");
    expect(channel.calls[0].msg).toContain("hello");
    expect(channel.calls[0].msg).toContain("a=1");
  });

  it("redacts saJwk in nested objects in both sinks", async () => {
    const log = makeLogger(baseOpts());
    log.info({ conn: { saJwk: "secret-here" } }, "x");
    await flush();

    const fileLine = JSON.stringify(readNdjson()[0]);
    expect(fileLine).not.toContain("secret-here");
    expect(fileLine).toContain("[Redacted]");

    expect(channel.calls[0].msg).not.toContain("secret-here");
    expect(channel.calls[0].msg).toContain("[Redacted]");
  });

  it("redacts authorization, token, and password fields recursively", async () => {
    const log = makeLogger(baseOpts());
    log.info(
      {
        req: { authorization: "Bearer abc" },
        creds: { token: "tok-xyz", password: "hunter2" },
      },
      "x",
    );
    await flush();

    const fileLine = JSON.stringify(readNdjson()[0]);
    expect(fileLine).not.toContain("Bearer abc");
    expect(fileLine).not.toContain("tok-xyz");
    expect(fileLine).not.toContain("hunter2");
    expect(fileLine.match(/\[Redacted\]/g)?.length ?? 0).toBe(3);
  });

  it("drops below-threshold lines when level is warn", async () => {
    const log = makeLogger(baseOpts({ level: "warn" }));
    log.info({}, "should-be-dropped");
    log.warn({}, "should-pass");
    await flush();

    const lines = readNdjson();
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe("should-pass");

    expect(channel.calls).toHaveLength(1);
    expect(channel.calls[0].level).toBe("warn");
  });

  it("child logger adds the component field on every record", async () => {
    const log = makeLogger(baseOpts());
    log.child({ component: "x.sub" }).info({}, "m");
    await flush();

    const r = readNdjson()[0];
    expect(r.component).toBe("x.sub");
    expect(channel.calls[0].msg).toContain("[x.sub]");
  });

  it("skips the file sink when fileEnabled is false", async () => {
    const log = makeLogger(baseOpts({ fileEnabled: false }));
    log.info({}, "channel-only");
    await flush();

    expect(fs.existsSync(path.join(tmpDir, "logs", "paic-journeys.ndjson"))).toBe(false);
    expect(channel.calls).toHaveLength(1);
  });

  it("rotates the file at maxBytes", async () => {
    // Use a tiny threshold so a handful of lines triggers rotation deterministically.
    const log = makeLogger(baseOpts({ maxBytes: 500, maxFiles: 3 }));
    for (let i = 0; i < 20; i++) {
      log.info({ i }, "fill");
    }
    await flush();

    const currentPath = path.join(tmpDir, "logs", "paic-journeys.ndjson");
    const rotatedPath = path.join(tmpDir, "logs", "paic-journeys.ndjson.1");
    expect(fs.existsSync(currentPath)).toBe(true);
    expect(fs.existsSync(rotatedPath)).toBe(true);
    // No file beyond maxFiles should accumulate.
    expect(fs.existsSync(path.join(tmpDir, "logs", "paic-journeys.ndjson.4"))).toBe(false);
  });

  it("maps each pino level to the correct channel method", async () => {
    const log = makeLogger(baseOpts());
    log.trace({}, "t");
    log.debug({}, "d");
    log.info({}, "i");
    log.warn({}, "w");
    log.error({}, "e");
    await flush();

    expect(channel.calls.map((c) => c.level)).toEqual(["trace", "debug", "info", "warn", "error"]);
  });
});
