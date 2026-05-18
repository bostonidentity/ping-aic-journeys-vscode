import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "esv" }>;
}

export function EsvCard({ payload }: Props) {
  const { name, host, realmName, esv } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">{esv ? `ESV (${esv.kind})` : "ESV"}</span>
        <h1>{name}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Realm</dt>
        <dd>{realmName}</dd>
        <dt>Name</dt>
        <dd>
          <code>{name}</code>
        </dd>
        {esv ? (
          <>
            <dt>Kind</dt>
            <dd>{esv.kind === "variable" ? "Variable" : "Secret"}</dd>
            {esv.kind === "variable" && esv.expressionType ? (
              <>
                <dt>Expression type</dt>
                <dd>
                  <code>{esv.expressionType}</code>
                </dd>
              </>
            ) : null}
            {esv.kind === "secret" && esv.encoding ? (
              <>
                <dt>Encoding</dt>
                <dd>
                  <code>{esv.encoding}</code>
                </dd>
              </>
            ) : null}
            {esv.description ? (
              <>
                <dt>Description</dt>
                <dd>{esv.description}</dd>
              </>
            ) : null}
            {esv.lastChangeDate ? (
              <>
                <dt>Last changed</dt>
                <dd>
                  <code>{esv.lastChangeDate}</code>
                </dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {esv ? null : <p className="hint">ESV resolution failed; showing name only.</p>}
    </article>
  );
}
