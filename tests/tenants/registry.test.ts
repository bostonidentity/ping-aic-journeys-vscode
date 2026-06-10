import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

import { beforeEach, describe, expect, it } from "vitest";
import type { Connection } from "@/domain/types";
import {
  makeTenantsRegistry,
  type TenantsRegistry,
  type TenantsRegistryDeps,
} from "@/tenants/registry";

interface FakeDeps {
  deps: TenantsRegistryDeps;
  /** Internal state for assertions. */
  config: Connection[];
  /** Internal state for assertions. */
  store: Map<string, string>;
  /** Records of `secrets.store` calls — assert correct keys/values. */
  storeCalls: Array<{ key: string; value: string }>;
  /** Records of `secrets.delete` calls — assert key removal. */
  deleteCalls: string[];
}

function makeFakeDeps(initial: Connection[] = []): FakeDeps {
  const state: FakeDeps = {
    config: [...initial],
    store: new Map(),
    storeCalls: [],
    deleteCalls: [],
    // Stitched below once state is in scope.
    deps: undefined as unknown as TenantsRegistryDeps,
  };
  state.deps = {
    config: {
      get: () => state.config,
      set: (value) => {
        state.config = value;
        return Promise.resolve();
      },
    },
    secrets: {
      get: (key) => Promise.resolve(state.store.get(key)),
      store: (key, value) => {
        state.store.set(key, value);
        state.storeCalls.push({ key, value });
        return Promise.resolve();
      },
      delete: (key) => {
        state.store.delete(key);
        state.deleteCalls.push(key);
        return Promise.resolve();
      },
    },
  };
  return state;
}

function makeFakeLogger() {
  const noop = () => undefined;
  const self = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => self,
    // biome-ignore lint/suspicious/noExplicitAny: pino Logger has many fields we don't exercise
  } as any;
  return self;
}

const KEY = (host: string) => `paicJourneys.saJwk.${host}`;

let fake: FakeDeps;
let registry: TenantsRegistry;
let changes: number;

beforeEach(() => {
  fake = makeFakeDeps();
  registry = makeTenantsRegistry(fake.deps, makeFakeLogger());
  changes = 0;
  registry.onDidChange(() => {
    changes++;
  });
});

describe("TenantsRegistry", () => {
  it("list returns the current config snapshot", async () => {
    expect(registry.list()).toEqual([]);
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-1");
    expect(registry.list()).toEqual([{ kind: "paic", host: "h1", saId: "s1" }]);
  });

  it("add persists the connection list, stores the JWK at the right key, and fires onDidChange", async () => {
    await registry.add({ kind: "paic", host: "h1", saId: "s1", name: "n1" }, "jwk-1");

    expect(fake.config).toEqual([{ kind: "paic", host: "h1", saId: "s1", name: "n1" }]);
    expect(fake.store.get(KEY("h1"))).toBe("jwk-1");
    expect(fake.storeCalls).toEqual([{ key: KEY("h1"), value: "jwk-1" }]);
    expect(changes).toBe(1);
  });

  it("update replaces the connection by host without renaming", async () => {
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-1");
    fake.storeCalls.length = 0;
    fake.deleteCalls.length = 0;
    changes = 0;

    await registry.update("h1", { kind: "paic", host: "h1", saId: "s1", name: "renamed" });

    expect(fake.config).toEqual([{ kind: "paic", host: "h1", saId: "s1", name: "renamed" }]);
    expect(fake.storeCalls).toEqual([]);
    expect(fake.deleteCalls).toEqual([]);
    expect(changes).toBe(1);
  });

  it("update with host rename and no newJwk moves the secret to the new key", async () => {
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-1");
    fake.storeCalls.length = 0;
    fake.deleteCalls.length = 0;

    await registry.update("h1", { kind: "paic", host: "h2", saId: "s1" });

    expect(fake.config).toEqual([{ kind: "paic", host: "h2", saId: "s1" }]);
    expect(fake.store.get(KEY("h2"))).toBe("jwk-1");
    expect(fake.store.has(KEY("h1"))).toBe(false);
    expect(fake.storeCalls).toEqual([{ key: KEY("h2"), value: "jwk-1" }]);
    expect(fake.deleteCalls).toEqual([KEY("h1")]);
  });

  it("update with host rename + newJwk stores newJwk at the new key and deletes the old key (old secret not preserved)", async () => {
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-old");
    fake.storeCalls.length = 0;
    fake.deleteCalls.length = 0;

    await registry.update("h1", { kind: "paic", host: "h2", saId: "s1" }, "jwk-new");

    expect(fake.store.get(KEY("h2"))).toBe("jwk-new");
    expect(fake.store.has(KEY("h1"))).toBe(false);
    // Only one secret-store call for the new key (no preserve-then-overwrite).
    expect(fake.storeCalls).toEqual([{ key: KEY("h2"), value: "jwk-new" }]);
  });

  it("update without rename but with newJwk overwrites the stored secret", async () => {
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-old");
    fake.storeCalls.length = 0;
    fake.deleteCalls.length = 0;

    await registry.update("h1", { kind: "paic", host: "h1", saId: "s1" }, "jwk-new");

    expect(fake.store.get(KEY("h1"))).toBe("jwk-new");
    expect(fake.deleteCalls).toEqual([]);
  });

  it("remove deletes from config and clears the secret; fires onDidChange", async () => {
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-1");
    await registry.add({ kind: "paic", host: "h2", saId: "s2" }, "jwk-2");
    changes = 0;
    fake.deleteCalls.length = 0;

    await registry.remove("h1");

    expect(fake.config).toEqual([{ kind: "paic", host: "h2", saId: "s2" }]);
    expect(fake.store.has(KEY("h1"))).toBe(false);
    expect(fake.store.has(KEY("h2"))).toBe(true);
    expect(fake.deleteCalls).toEqual([KEY("h1")]);
    expect(changes).toBe(1);
  });

  it("getJwk reads from secrets via the correct prefix", async () => {
    fake.store.set(KEY("custom"), "jwk-custom");
    await expect(registry.getJwk("custom")).resolves.toBe("jwk-custom");
    await expect(registry.getJwk("missing")).resolves.toBeUndefined();
  });

  it("dispose disposes the event emitter — further fires don't reach listeners", async () => {
    registry.dispose();
    changes = 0;
    await registry.add({ kind: "paic", host: "h1", saId: "s1" }, "jwk-1");
    expect(changes).toBe(0);
  });
});
