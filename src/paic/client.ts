import type { Journey, NodePayload, Realm, Script } from "../domain/types";
import type { Logger } from "../util/logger";
import type { HttpClient } from "./http";
import {
  mapJourney,
  mapNodePayload,
  mapRealm,
  mapScript,
  type RawJourney,
  type RawNodePayload,
  type RawRealm,
  type RawScript,
} from "./mappers";
import { listAllPaged, type PagedResponse } from "./pagination";
import { getRealmPath } from "./realm-path";

const TREE_API_VERSION = "protocol=2.1,resource=1.0";
const SCRIPT_API_VERSION = "protocol=2.0,resource=1.0";
const REALM_API_VERSION = "protocol=2.0,resource=1.0";

export interface PaicClient {
  listRealms(): Promise<Realm[]>;
  listJourneys(realm: string): Promise<Journey[]>;
  getJourney(realm: string, id: string): Promise<Journey>;
  getNode(realm: string, nodeType: string, nodeId: string): Promise<NodePayload>;
  getScript(realm: string, id: string): Promise<Script>;
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
  };
}
