import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "socialIdp" }>;
}

export function SocialIdpCard({ payload }: Props) {
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
    </article>
  );
}
