import type { ExportComponentKind, SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "socialIdp" }>;
  onExport?: (
    host: string,
    realm: string,
    kind: ExportComponentKind,
    id: string,
    name?: string,
  ) => void;
}

export function SocialIdpCard({ payload, onExport }: Props) {
  const { name, host, realmName, idp } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Social IdP</span>
        <h1>{name}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Realm</dt>
        <dd>{realmName}</dd>
        <dt>Provider</dt>
        <dd>
          <code>{name}</code>
        </dd>
        {idp ? (
          <>
            <dt>Type</dt>
            <dd>
              <code>{idp.type}</code>
            </dd>
            <dt>Enabled</dt>
            <dd>{idp.enabled ? "Yes" : "No"}</dd>
          </>
        ) : null}
      </dl>
      {idp ? null : <p className="hint">Social-IdP resolution failed; showing name only.</p>}
      {onExport ? (
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            onClick={() => onExport(host, realmName, "socialIdp", name, name)}
          >
            <i className="codicon codicon-export" aria-hidden />
            Export…
          </button>
        </div>
      ) : null}
    </article>
  );
}
