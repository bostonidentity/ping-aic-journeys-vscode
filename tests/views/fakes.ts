import { vi } from "vitest";
import type { ResolvedGraph } from "@/domain/resolved-graph";
import type {
  EmailTemplate,
  Esv,
  EsvSecret,
  EsvVariable,
  Journey,
  NodePayload,
  Realm,
  Script,
  SocialIdp,
  Theme,
} from "@/domain/types";
import type { PaicClient } from "@/paic/client";
import type { ResolverCache } from "@/resolver/cache";
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
  /** Key format: `${realm}:byName:${name}` — for `getScriptByName` resolution. */
  scriptsByName?: Record<string, Script>;
  /** Key format: `${realm}:${themeId}`. */
  themesByKey?: Record<string, Theme>;
  /** Key = template name. */
  emailTemplatesByName?: Record<string, EmailTemplate>;
  /** Key = realm. Full list returned by `listSocialIdps(realm)`. */
  socialIdpsByRealm?: Record<string, SocialIdp[]>;
  /** Key = ESV name. */
  esvsByName?: Record<string, Esv>;
  /** Full tenant ESV-variable list returned by `listVariables()`. */
  variables?: EsvVariable[];
  /** Full tenant ESV-secret list returned by `listSecrets()`. */
  secrets?: EsvSecret[];
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
    getRawScript: vi.fn((realm: string, id: string) =>
      Promise.reject(new Error(`getRawScript not stubbed in fake (${realm}:${id})`)),
    ),
    getRawJourney: vi.fn((realm: string, id: string) =>
      Promise.reject(new Error(`getRawJourney not stubbed in fake (${realm}:${id})`)),
    ),
    getRawNode: vi.fn((realm: string, t: string, id: string) =>
      Promise.reject(new Error(`getRawNode not stubbed in fake (${realm}:${t}:${id})`)),
    ),
    getRawScriptByName: vi.fn(() => Promise.resolve(null)),
    getRawTheme: vi.fn(() => Promise.resolve(null)),
    getRawEmailTemplate: vi.fn(() => Promise.resolve(null)),
    getRawSocialIdp: vi.fn(() => Promise.resolve(null)),
    getRawEsv: vi.fn(() => Promise.resolve(null)),
    getScriptByName: vi.fn((realm: string, name: string) => {
      const key = `${realm}:byName:${name}`;
      // Returning null mirrors the real client's "miss" — caller emits a
      // `[missing library: <name>]` MessageNode rather than throwing.
      return Promise.resolve(data.scriptsByName?.[key] ?? null);
    }),
    getTheme: vi.fn((realm: string, themeId: string) => {
      return Promise.resolve(data.themesByKey?.[`${realm}:${themeId}`] ?? null);
    }),
    listThemes: vi.fn((realm: string) => {
      const prefix = `${realm}:`;
      const list = Object.entries(data.themesByKey ?? {})
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v);
      return Promise.resolve(list);
    }),
    getEmailTemplate: vi.fn((name: string) => {
      return Promise.resolve(data.emailTemplatesByName?.[name] ?? null);
    }),
    listSocialIdps: vi.fn((realm: string) => {
      return Promise.resolve(data.socialIdpsByRealm?.[realm] ?? []);
    }),
    getSocialIdp: vi.fn((realm: string, name: string) => {
      const all = data.socialIdpsByRealm?.[realm] ?? [];
      return Promise.resolve(all.find((i) => i.name === name) ?? null);
    }),
    getEsv: vi.fn((name: string) => {
      return Promise.resolve(data.esvsByName?.[name] ?? null);
    }),
    listVariables: vi.fn((_realm: string) => {
      return Promise.resolve(data.variables ?? []);
    }),
    listSecrets: vi.fn((_realm: string) => {
      return Promise.resolve(data.secrets ?? []);
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

/** Stub `ResolverCache` whose `resolve` returns whatever the caller stuffed
 * into `graphsByKey` (keyed by `${host}|${realm}|${kind}|${id}`). Misses
 * reject with `Error("no fixture")` so tests must wire what they expect. */
export interface FakeResolverCacheOpts {
  graphsByKey?: Record<string, ResolvedGraph>;
  /** Hand a rejection back from `resolve` regardless of key. Useful for the
   * error-path test. */
  rejectWith?: Error;
}

export function makeFakeResolverCache(opts: FakeResolverCacheOpts = {}): ResolverCache {
  return {
    resolve: vi.fn((key) => {
      if (opts.rejectWith) return Promise.reject(opts.rejectWith);
      const k = `${key.host}|${key.realm}|${key.kind}|${key.id}`;
      const g = opts.graphsByKey?.[k];
      if (!g) return Promise.reject(new Error(`no fake graph for ${k}`));
      return Promise.resolve(g);
    }),
    dropOne: vi.fn(() => undefined),
    dropAllForHost: vi.fn(() => undefined),
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
