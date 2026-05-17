import * as fs from "node:fs";
import * as path from "node:path";
import { Writable } from "node:stream";
import pino, { type Level, type Logger, multistream, type StreamEntry } from "pino";
import type * as vscode from "vscode";

// Service identity baked into every record (see docs/logging-spec.md).
const SERVICE = "paic-journeys";

// File-sink rotation policy.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

// Pino redact paths — values matching are replaced with REDACT_CENSOR.
// Recursive (the `*.X` form). See docs/logging-spec.md.
const REDACT_PATHS = [
  "saJwk",
  "*.saJwk",
  "jwk",
  "*.jwk",
  "bearer",
  "*.bearer",
  "assertion",
  "*.assertion",
  "access_token",
  "*.access_token",
  "*.password",
  "*.token",
  "*.secret",
  "authorization",
  "*.authorization",
];
const REDACT_CENSOR = "[Redacted]";

export interface LoggerOptions {
  storageUri: vscode.Uri;
  version: string;
  level: Level;
  fileEnabled: boolean;
  channel: vscode.LogOutputChannel;
  // Optional rotation overrides (mostly for tests). Defaults: 5 MB × 5 files.
  maxBytes?: number;
  maxFiles?: number;
}

export type { Logger };

export function makeLogger(opts: LoggerOptions): Logger {
  // Multistream filters each stream independently and defaults to `info` per
  // entry; we must set the per-stream level explicitly so trace/debug pass
  // through when the root level is below info.
  const streams: StreamEntry[] = [{ stream: makeChannelAdapter(opts.channel), level: opts.level }];

  if (opts.fileEnabled) {
    const filepath = path.join(opts.storageUri.fsPath, "logs", "paic-journeys.ndjson");
    streams.push({
      stream: new RotatingFileStream(
        filepath,
        opts.maxBytes ?? MAX_BYTES,
        opts.maxFiles ?? MAX_FILES,
      ),
      level: opts.level,
    });
  }

  return pino(
    {
      level: opts.level,
      base: { service: SERVICE, version: opts.version },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    },
    multistream(streams),
  );
}

// ─── Channel adapter ──────────────────────────────────────────────────────
// Pino emits one NDJSON line per record. We parse it, route to the matching
// channel method (so VS Code colors error/warn appropriately), and format
// a short human-readable line for the Output panel.

function makeChannelAdapter(channel: vscode.LogOutputChannel): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      const line = chunk.toString("utf8").trimEnd();
      if (!line) {
        cb();
        return;
      }
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const method = pinoLevelToChannelMethod(record.level);
        const human = formatHumanLine(record);
        channel[method](human);
      } catch {
        // If the line wasn't JSON for any reason, surface it raw rather
        // than swallowing — better noisy than silent.
        channel.info(line);
      }
      cb();
    },
  });
}

function pinoLevelToChannelMethod(level: unknown): "trace" | "debug" | "info" | "warn" | "error" {
  // pino numeric levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
  if (typeof level !== "number") return "info";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}

function formatHumanLine(record: Record<string, unknown>): string {
  // Surface fields commonly inspected, then dump the rest as k=v pairs.
  // Order matches what a reader scans for first: component, event, msg, errors, then everything else.
  const {
    time: _time,
    level: _level,
    service: _service,
    version: _version,
    component,
    event,
    msg,
    err,
    ...rest
  } = record;

  const prefix = component ? `[${String(component)}] ` : "";
  const eventStr = event ? `${String(event)} ` : "";
  const msgStr = msg ? String(msg) : "";

  const extras: string[] = [];
  for (const [k, v] of Object.entries(rest)) {
    extras.push(`${k}=${stringify(v)}`);
  }
  const extrasStr = extras.length > 0 ? ` ${extras.join(" ")}` : "";

  const errStr = err ? ` err=${stringify(err)}` : "";

  return `${prefix}${eventStr}${msgStr}${extrasStr}${errStr}`.trimEnd();
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ─── Rotating file sink ───────────────────────────────────────────────────
// 50-line in-process rotation. Justified over pino-roll because pino-roll is
// a worker-thread transport and pino.multistream wants sync streams in the
// fan-out array. Worker-thread fragility inside the VS Code extension host
// is also a concern.

class RotatingFileStream extends Writable {
  private bytesWritten = 0;
  private fd?: number;

  constructor(
    private readonly filepath: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
  ) {
    super({ decodeStrings: false });
    this.open();
  }

  private open(): void {
    fs.mkdirSync(path.dirname(this.filepath), { recursive: true });
    // openSync creates the file immediately (unlike createWriteStream, which
    // opens lazily on first write). We need the file to exist synchronously
    // so renameSync during rotate() can find it.
    this.fd = fs.openSync(this.filepath, "a");
    try {
      this.bytesWritten = fs.fstatSync(this.fd).size;
    } catch {
      this.bytesWritten = 0;
    }
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    if (this.fd === undefined) {
      cb();
      return;
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || "utf8");
    fs.writeSync(this.fd, buf);
    this.bytesWritten += buf.byteLength;
    if (this.bytesWritten >= this.maxBytes) {
      this.rotate();
    }
    cb();
  }

  private rotate(): void {
    if (this.fd === undefined) return;
    fs.closeSync(this.fd);
    this.fd = undefined;

    // Shift .N → .N+1 (oldest first to avoid overwrite).
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${this.filepath}.${i}`;
      const to = `${this.filepath}.${i + 1}`;
      try {
        fs.renameSync(from, to);
      } catch {
        // Missing rotations are expected during steady state.
      }
    }
    try {
      fs.renameSync(this.filepath, `${this.filepath}.1`);
    } catch {
      // Current may have been removed externally; reopen anyway.
    }
    try {
      fs.unlinkSync(`${this.filepath}.${this.maxFiles + 1}`);
    } catch {
      // Beyond-retention file may not exist yet.
    }
    this.bytesWritten = 0;
    this.open();
  }

  override _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
    if (this.fd !== undefined) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // already closed
      }
      this.fd = undefined;
    }
    cb(err);
  }
}
