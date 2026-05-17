import { vi } from "vitest";
import type { Journey, NodePayload, Realm, Script } from "@/domain/types";
import type { PaicClient } from "@/paic/client";
import type { ClientCache } from "@/tenants/client-cache";

/** In-memory `PaicClient` driven by canned data the test puts into the deps.
 *  Each method returns the configured response for its (realm, id) args. */
export interface FakePaicClientData {
  realms?: Realm[];
  journeysByRealm?: Record<string, Journey[]>;
  journeyById?: Record<string, Journey>;
  /** Key format: `${realm}:${nodeType}:${nodeId}` */
  nodesByKey?: Record<string, NodePayload>;
  scriptsByKey?: Record<string, Script>;
}

export function makeFakePaicClient(data: FakePaicClientData): PaicClient {
  return {
    listRealms: vi.fn(() => Promise.resolve(data.realms ?? [])),
    listJourneys: vi.fn((realm: string) => Promise.resolve(data.journeysByRealm?.[realm] ?? [])),
    getJourney: vi.fn((_realm: string, id: string) => {
      const j = data.journeyById?.[id];
      if (!j) return Promise.reject(new Error(`no fixture for getJourney(${id})`));
      return Promise.resolve(j);
    }),
    getNode: vi.fn((realm: string, nodeType: string, nodeId: string) => {
      const key = `${realm}:${nodeType}:${nodeId}`;
      const p = data.nodesByKey?.[key];
      if (!p) return Promise.reject(new Error(`no fixture for getNode(${key})`));
      return Promise.resolve(p);
    }),
    getScript: vi.fn((realm: string, id: string) => {
      const key = `${realm}:${id}`;
      const s = data.scriptsByKey?.[key];
      if (!s) return Promise.reject(new Error(`no fixture for getScript(${key})`));
      return Promise.resolve(s);
    }),
  };
}

/** A `ClientCache` that always returns the same fake client. */
export function makeFakeCache(client: PaicClient): ClientCache {
  return {
    get: vi.fn(() => Promise.resolve(client)),
    drop: vi.fn(() => undefined),
    dispose: vi.fn(() => undefined),
  };
}

export function makeFakeLogger() {
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
