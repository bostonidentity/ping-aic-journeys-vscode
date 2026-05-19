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
} from "../domain/types";
import type { Logger } from "../util/logger";
import { PaicError } from "./errors";
import type { HttpClient } from "./http";
import {
  mapEmailTemplate,
  mapEsvSecret,
  mapEsvVariable,
  mapJourney,
  mapNodePayload,
  mapRealm,
  mapScript,
  mapSocialIdp,
  mapTheme,
  type RawEmailTemplate,
  type RawEsvSecret,
  type RawEsvVariable,
  type RawJourney,
  type RawNodePayload,
  type RawRealm,
  type RawScript,
  type RawSocialIdp,
  type RawThemeRealmConfig,
} from "./mappers";
import { listAllPaged, type PagedResponse } from "./pagination";
import { getRealmPath } from "./realm-path";

const TREE_API_VERSION = "protocol=2.1,resource=1.0";
const SCRIPT_API_VERSION = "protocol=2.0,resource=1.0";
const REALM_API_VERSION = "protocol=2.0,resource=1.0";
const SOCIAL_IDP_API_VERSION = "protocol=2.1,resource=1.0";
const ESV_API_VERSION = "protocol=1.0,resource=1.0";

export interface PaicClient {
  listRealms(): Promise<Realm[]>;
  listJourneys(realm: string): Promise<Journey[]>;
  getJourney(realm: string, id: string): Promise<Journey>;
  getNode(realm: string, nodeType: string, nodeId: string): Promise<NodePayload>;
  getScript(realm: string, id: string): Promise<Script>;
  /** Lookup a script by name in a realm. Used to resolve library-script
   * references (`require('<name>')`) discovered during script-body parsing.
   * Returns `null` if no script in the realm has that name. */
  getScriptByName(realm: string, name: string): Promise<Script | null>;

  // M3 Slice 3 — journey-level resource lookups.

  /** Fetch a single theme by id from a realm. Internally fetches the whole
   * `ui/themerealm` IDM config and filters; returns null if not found. */
  getTheme(realm: string, themeId: string): Promise<Theme | null>;
  /** Return every theme in a realm. Single fetch of `ui/themerealm`; lets
   * the tree pre-resolve multiple PageNode.themeIds in one round-trip. */
  listThemes(realm: string): Promise<Theme[]>;
  /** Fetch a single IDM email template by name. Returns null on 404. */
  getEmailTemplate(name: string): Promise<EmailTemplate | null>;
  /** List all social IdPs in a realm (one POST via `_action=nextdescendents`). */
  listSocialIdps(realm: string): Promise<SocialIdp[]>;
  /** Fetch a single social IdP in a realm by its name. AIC's REST API requires
   * (type, id) for direct lookup, but our callers only carry the name → this
   * method fetches the full realm list and filters. Returns null if no IdP
   * with that name exists in the realm. */
  getSocialIdp(realm: string, name: string): Promise<SocialIdp | null>;
  /** Fetch an ESV by name — tries `/environment/variables/<name>` first,
   * falls through to `/environment/secrets/<name>` on 404. Returns null on
   * double-miss. */
  getEsv(name: string): Promise<Esv | null>;
  /** List all ESV variables in the tenant (paged). `realm` arg accepted for
   * API symmetry but the endpoint is tenant-scoped. Returned `name`s are in
   * canonical dotted form (REST `_id`s are hyphenated; translated here). */
  listVariables(realm: string): Promise<EsvVariable[]>;
  /** List all ESV secrets in the tenant (paged). Same scope + naming notes
   * as `listVariables`. */
  listSecrets(realm: string): Promise<EsvSecret[]>;
}

export interface PaicClientOptions {
  http: HttpClient;
  log: Logger;
}

/**
 * Build a PAIC API client bound to one tenant's `HttpClient`. The client owns
 * URL construction (realm-path), API versioning per endpoint family, and
 * raw → domain translation. Authentication, retries, error wrapping, and
 * logging are delegated to the injected `HttpClient`.
 */
export function makePaicClient(opts: PaicClientOptions): PaicClient {
  const log = opts.log.child({ component: "paic.client" });
  const { http } = opts;

  return {
    async listRealms(): Promise<Realm[]> {
      const all = await listAllPaged<RawRealm>(async (cookie) => {
        const params = new URLSearchParams({ _queryFilter: "true" });
        if (cookie) params.set("_pagedResultsCookie", cookie);
        const resp = await http.get<PagedResponse<RawRealm>>(
          `/am/json/global-config/realms?${params.toString()}`,
          { apiVersion: REALM_API_VERSION },
        );
        return resp.data;
      });
      log.debug({ event: "client.listRealms.done", count: all.length }, "Listed realms");
      return all.map(mapRealm);
    },

    async listJourneys(realm: string): Promise<Journey[]> {
      const realmPath = getRealmPath(realm);
      const all = await listAllPaged<RawJourney>(async (cookie) => {
        const params = new URLSearchParams({ _queryFilter: "true" });
        if (cookie) params.set("_pagedResultsCookie", cookie);
        const resp = await http.get<PagedResponse<RawJourney>>(
          `/am/json${realmPath}/realm-config/authentication/authenticationtrees/trees?${params.toString()}`,
          { apiVersion: TREE_API_VERSION },
        );
        return resp.data;
      });
      log.debug({ event: "client.listJourneys.done", realm, count: all.length }, "Listed journeys");
      return all.map(mapJourney);
    },

    async getJourney(realm: string, id: string): Promise<Journey> {
      const realmPath = getRealmPath(realm);
      const resp = await http.get<RawJourney>(
        `/am/json${realmPath}/realm-config/authentication/authenticationtrees/trees/${encodeURIComponent(id)}`,
        { apiVersion: TREE_API_VERSION },
      );
      return mapJourney(resp.data);
    },

    async getNode(realm: string, nodeType: string, nodeId: string): Promise<NodePayload> {
      const realmPath = getRealmPath(realm);
      const resp = await http.get<RawNodePayload>(
        `/am/json${realmPath}/realm-config/authentication/authenticationtrees/nodes/${encodeURIComponent(nodeType)}/${encodeURIComponent(nodeId)}`,
        { apiVersion: TREE_API_VERSION },
      );
      return mapNodePayload(resp.data);
    },

    async getScript(realm: string, id: string): Promise<Script> {
      const realmPath = getRealmPath(realm);
      const resp = await http.get<RawScript>(
        `/am/json${realmPath}/scripts/${encodeURIComponent(id)}`,
        { apiVersion: SCRIPT_API_VERSION },
      );
      return mapScript(resp.data);
    },

    async getScriptByName(realm: string, name: string): Promise<Script | null> {
      const realmPath = getRealmPath(realm);
      const params = new URLSearchParams({ _queryFilter: `name eq "${name}"` });
      const resp = await http.get<PagedResponse<RawScript>>(
        `/am/json${realmPath}/scripts?${params.toString()}`,
        { apiVersion: SCRIPT_API_VERSION },
      );
      const first = resp.data.result[0];
      if (!first) {
        log.debug(
          { event: "client.getScriptByName.miss", realm, script_name: name },
          "No script with that name in realm",
        );
        return null;
      }
      return mapScript(first);
    },

    async getTheme(realm: string, themeId: string): Promise<Theme | null> {
      // AIC stores all themes for all realms in one IDM config doc. The
      // top-level key is `realm` (singular) and the per-realm value is the
      // theme array directly — no `.themes` wrapper. Verified against sb3.
      const resp = await http.get<RawThemeRealmConfig>("/openidm/config/ui/themerealm");
      const themes = resp.data.realm?.[realm] ?? [];
      const found = themes.find((t) => t._id === themeId);
      if (!found) {
        log.debug({ event: "client.getTheme.miss", realm, theme_id: themeId }, "Theme not found");
        return null;
      }
      return mapTheme(realm, found);
    },

    async listThemes(realm: string): Promise<Theme[]> {
      // One fetch of the whole themerealm doc; the tree uses this to
      // pre-resolve multiple PageNode.themeIds in one round-trip during a
      // journey expansion.
      const resp = await http.get<RawThemeRealmConfig>("/openidm/config/ui/themerealm");
      const raws = resp.data.realm?.[realm] ?? [];
      return raws.map((raw) => mapTheme(realm, raw));
    },

    async getEmailTemplate(name: string): Promise<EmailTemplate | null> {
      try {
        const resp = await http.get<RawEmailTemplate>(
          `/openidm/config/emailTemplate/${encodeURIComponent(name)}`,
        );
        return mapEmailTemplate(name, resp.data);
      } catch (err) {
        if (err instanceof PaicError && err.status === 404) return null;
        throw err;
      }
    },

    async listSocialIdps(realm: string): Promise<SocialIdp[]> {
      const realmPath = getRealmPath(realm);
      const resp = await http.post<{ result?: RawSocialIdp[] }>(
        `/am/json${realmPath}/realm-config/services/SocialIdentityProviders?_action=nextdescendents`,
        {},
        { apiVersion: SOCIAL_IDP_API_VERSION },
      );
      return (resp.data.result ?? []).map((r) => mapSocialIdp(realm, r));
    },

    async getSocialIdp(realm: string, name: string): Promise<SocialIdp | null> {
      const all = await this.listSocialIdps(realm);
      const found = all.find((i) => i.name === name);
      if (!found) {
        log.debug(
          { event: "client.getSocialIdp.miss", realm, idp_name: name },
          "Social IdP not found in realm",
        );
        return null;
      }
      return found;
    },

    async listVariables(_realm: string): Promise<EsvVariable[]> {
      // ESV endpoints are tenant-scoped, not realm-scoped. _realm accepted for
      // API symmetry. Returned names are dotted (translated from hyphenated _id).
      const all = await listAllPaged<RawEsvVariable>(async (cookie) => {
        const params = new URLSearchParams({ _queryFilter: "true" });
        if (cookie) params.set("_pagedResultsCookie", cookie);
        const resp = await http.get<PagedResponse<RawEsvVariable>>(
          `/environment/variables?${params.toString()}`,
          { apiVersion: ESV_API_VERSION },
        );
        return resp.data;
      });
      return all.map((raw) => mapEsvVariable((raw._id ?? "").replaceAll("-", "."), raw));
    },

    async listSecrets(_realm: string): Promise<EsvSecret[]> {
      const all = await listAllPaged<RawEsvSecret>(async (cookie) => {
        const params = new URLSearchParams({ _queryFilter: "true" });
        if (cookie) params.set("_pagedResultsCookie", cookie);
        const resp = await http.get<PagedResponse<RawEsvSecret>>(
          `/environment/secrets?${params.toString()}`,
          { apiVersion: ESV_API_VERSION },
        );
        return resp.data;
      });
      return all.map((raw) => mapEsvSecret((raw._id ?? "").replaceAll("-", "."), raw));
    },

    async getEsv(name: string): Promise<Esv | null> {
      // PAIC ESV REST ids are hyphenated (`esv-foo-bar`) while scripts
      // reference them in dotted form (`esv.foo.bar`). Translate before the
      // URL; keep `name` (dotted) as the canonical display name.
      // POC-validated against sb3: `/variables/esv.kyid.portal.name` → 400;
      // `/variables/esv-kyid-portal-name` → 200.
      const apiId = name.replaceAll(".", "-");
      try {
        const resp = await http.get<RawEsvVariable>(
          `/environment/variables/${encodeURIComponent(apiId)}`,
          { apiVersion: ESV_API_VERSION },
        );
        return mapEsvVariable(name, resp.data);
      } catch (err) {
        if (!(err instanceof PaicError) || err.status !== 404) throw err;
      }
      try {
        const resp = await http.get<RawEsvSecret>(
          `/environment/secrets/${encodeURIComponent(apiId)}`,
          { apiVersion: ESV_API_VERSION },
        );
        return mapEsvSecret(name, resp.data);
      } catch (err) {
        if (err instanceof PaicError && err.status === 404) return null;
        throw err;
      }
    },
  };
}
