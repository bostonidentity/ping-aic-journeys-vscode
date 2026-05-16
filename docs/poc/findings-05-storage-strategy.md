# Storage plan

## Data shape

Per tenant:
- `host` — string, unique, stable identity
- `saId` — string
- `name?` — string, optional label (falls back to `host`)
- `saJwk` — secret (JSON-stringified JWK)

## Where each lives

| Field | VS Code store | Notes |
|---|---|---|
| `host`, `saId`, `name` | `settings.json` (`aicJourneys.tenants` array) | User-editable, syncable via Settings Sync, version-controllable. |
| `saJwk` | `SecretStorage` (`context.secrets`) | OS keychain. Never syncs. Keyed by `"aicJourneys.saJwk." + host`. |

`host` is the join key between the two stores.

## Global vs workspace

Use VS Code's native `ConfigurationTarget`:
- **Global** tenants — `ConfigurationTarget.Global` → user-level `settings.json` → visible everywhere.
- **Workspace** tenants — `ConfigurationTarget.Workspace` → `.vscode/settings.json` → visible in this repo only, checkinable.

Tree view reads both via `config.inspect("tenants").globalValue` + `.workspaceValue` and dedupes by `host`.

`SecretStorage` is single-tier (machine-local, not scoped) — fine, `host` is unique either way.

## Operations

| Op | Steps |
|---|---|
| Add | Prompt host/saId/JWK → append to settings array → `secrets.store("aicJourneys.saJwk." + host, jwk)` |
| Remove | Drop from settings array → `secrets.delete("aicJourneys.saJwk." + host)` |
| Load | Read settings → look up secret by host → if missing, mark "credentials missing" in tree |
| Edit JWK | Command only, never via settings.json |

## Failure modes (handle, don't crash)

- **Settings entry, no secret** (e.g. settings synced to a new machine): show "credentials missing" in tree; right-click → "Set Credentials." No error at activation.
- **Secret, no settings entry** (orphan after manual edit): provide a "Clean Up Orphaned Credentials" command. Never auto-delete.

## What we are NOT doing

- No master key / local encryption (SecretStorage handles it).
- No synthetic UUID (host is the id).
- No registry file in `globalStorageUri` (settings.json is the registry).
- No schema version field yet (3 fields + 1 secret; revisit when shape grows).
- No export bundle (settings.json already shareable; secrets are per-machine on purpose).
- No database, no SQLite.

## Code surface

~40 lines in `src/tenants/registry.ts`:
- `list(): Tenant[]`
- `getJwk(host): Promise<string | undefined>`
- `add(t, jwk): Promise<void>`
- `remove(host): Promise<void>`
- `hasCredentials(host): Promise<boolean>`
