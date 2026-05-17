import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "script" }>;
  onOpenBody?: (host: string, realm: string, scriptId: string, language?: string) => void;
}

export function ScriptCard({ payload, onOpenBody }: Props) {
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
      {onOpenBody ? (
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            onClick={() => onOpenBody(host, realmName, scriptId, script?.language)}
          >
            Open body in editor
          </button>
        </div>
      ) : null}
    </article>
  );
}
