# Changelog

All notable changes to the **PAIC Journeys** extension are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project follows [Semantic Versioning](https://semver.org/).

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
