# Changelog

All notable changes to the **PAIC Journeys** extension are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project follows [Semantic Versioning](https://semver.org/).

## [0.0.2] — 2026-05-26

### Fixed
- Inspector panel could stay stuck on the "Select a tree node to inspect" placeholder on first open over slow IPC (Remote Desktop / high-latency display). The first `select` message from the extension could arrive at the webview before React mounted and registered its `message` listener; outbound posts are now gated on a `ready` handshake from the webview (with a 5-second timeout fallback so a genuinely broken webview can't wedge the panel silently).
- `paicJourneys.connections` could be written into the workspace `.vscode/settings.json` of whatever folder happened to be open when a connection was added, instead of staying in the per-user (global) settings as designed. Connections are now always read from and written to the user-level settings, and the property is declared `"scope": "application"` so VS Code itself ignores any stray workspace-level entries.
- `paicJourneys.logging.level` and `paicJourneys.logging.fileEnabled` are now also application-scoped (per-user only). Workspace-level overrides for either setting are ignored both by VS Code and by the extension's read path. Consistent with `paicJourneys.connections`: nothing this extension reads can be polluted by a project's `.vscode/settings.json`.

## [0.0.1] — Initial release

First public release on the Visual Studio Code Marketplace.

### Added
- Multi-connection PAIC sidebar with service-account JWT-bearer auth; JWKs stored in VS Code SecretStorage.
- Per-realm journey tree: connection → realm → journey → inner journeys / scripts / library scripts.
- Inline script bodies via the `paic-script://` file-system provider (real editor tabs, full syntax highlighting).
- Script diff across connections.
- Dependency inspector panel (Direct, Full tree, Flat) with a resolver cache.
- Search page: reverse-dependency lookup, search-by-name, orphans, and a realm index.
- Find-usages from any script or inner journey.
- Structured NDJSON logging with configurable level.
