# PAIC Journeys

Browse and analyze **journey dependency graphs** in Ping Advanced Identity Cloud (PAIC) tenants — without leaving VS Code.

Connect to one or more PAIC tenants via service-account JWT-bearer auth, then explore each journey's full transitive dependency tree (inner journeys, scripted decisions, library scripts, themes, ESVs) right in the sidebar.

## Features

- **Multi-tenant sidebar.** Add as many PAIC connections as you need. Credentials are minted on demand and the service-account JWK lives in VS Code SecretStorage, never on disk in plaintext.
- **Per-realm journey tree.** Drill from connection → realm → journey → inner journeys / scripts / library scripts in a familiar tree view.
- **Inline script bodies.** Open any script in a real editor tab via the `paic-script://` provider — full syntax highlighting, no copy-paste round-trip.
- **Diff across tenants.** Pick a script and compare its body against another connection in one click.
- **Dependency inspector.** A side panel shows direct deps, full transitive tree, and a flat dedup list for the selected journey.
- **Search.** Reverse-dependency lookup, search-by-name, and orphan finder across the realm index.
- **Find usages.** From any script or inner journey, jump to every journey/realm that references it.

## Requirements

- VS Code **1.85** or newer.
- A PAIC tenant and a **service account** in that tenant with at least Journey/Script read permissions. You will need:
  - The tenant host (e.g. `openam-<tenant>.id.forgerock.io`)
  - The service account ID (UUID)
  - The service account JWK (JSON)

## Getting started

1. Install **PAIC Journeys** from the VS Code Marketplace.
2. Click the new **PAIC Journeys** icon in the activity bar.
3. Click **Add Connection** in the Connections view, fill in host / saId / JWK, save.
4. Expand the connection to browse realms → journeys → dependencies.

## Settings

| Setting | Description |
|---|---|
| `paicJourneys.connections` | Per-connection metadata (host, saId, optional display name). The JWK is **not** stored here — it lives in SecretStorage. |
| `paicJourneys.logging.level` | Log verbosity (`error`, `warn`, `info`, `debug`, `trace`). Default `info`. |
| `paicJourneys.logging.fileEnabled` | Whether to also write structured NDJSON logs to disk for shippers (Vector, Filebeat, Promtail). Output panel always reflects logs regardless. |

## Privacy & security

- The JWK never leaves SecretStorage; access tokens stay in extension memory only.
- The extension makes no telemetry calls and only contacts the PAIC hosts you have configured.
- Webviews never receive credentials — only the data the extension chose to render.

## Issues & feedback

Please file issues at [github.com/bostonidentity/ping-aic-journeys-vscode/issues](https://github.com/bostonidentity/ping-aic-journeys-vscode/issues).

## License

MIT — see [LICENSE](./LICENSE).
