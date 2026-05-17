import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "script" }>;
}

export function ScriptCard({ payload }: Props) {
  const { scriptId, host, realmName, script } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Script</span>
        <h1>{script?.name ?? scriptId}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Realm</dt>
        <dd>{realmName}</dd>
        <dt>Script ID</dt>
        <dd>
          <code>{scriptId}</code>
        </dd>
        {script?.language ? (
          <>
            <dt>Language</dt>
            <dd>{script.language}</dd>
          </>
        ) : null}
      </dl>
      <p className="hint">Script body rendering arrives in M2.</p>
    </article>
  );
}
