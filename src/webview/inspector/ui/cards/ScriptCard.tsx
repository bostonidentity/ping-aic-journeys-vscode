import type { NodeRef, SelectPayload } from "../../../messages";

export interface ScriptCardDeps {
  libraryScripts: NodeRef[];
  esvs: NodeRef[];
}

interface Props {
  payload: Extract<SelectPayload, { kind: "script" }>;
  deps?: ScriptCardDeps | null;
  onNavigate?: (uid: string) => void;
  onOpenBody?: (host: string, realm: string, scriptId: string, language?: string) => void;
}

export function ScriptCard({ payload, deps, onNavigate, onOpenBody }: Props) {
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
      <ScriptDepsBlock deps={deps ?? null} onNavigate={onNavigate} />
    </article>
  );
}

interface ScriptDepsProps {
  deps: ScriptCardDeps | null;
  onNavigate?: (uid: string) => void;
}

/** Shared deps block — reused by `LibraryScriptCard` too. Renders the
 * library-script + ESV lists discovered by parsing the script body. */
export function ScriptDepsBlock({ deps, onNavigate }: ScriptDepsProps) {
  if (!deps) {
    return (
      <section className="deps-loading">
        <em>Resolving script-body dependencies…</em>
      </section>
    );
  }
  if (deps.libraryScripts.length === 0 && deps.esvs.length === 0) {
    return (
      <section className="deps-empty">
        <em>No library scripts or ESVs referenced.</em>
      </section>
    );
  }
  return (
    <section className="deps">
      {deps.libraryScripts.length > 0 ? (
        <>
          <h2>Library scripts ({deps.libraryScripts.length})</h2>
          <ul>
            {deps.libraryScripts.map((l) => (
              <li key={l.uid}>
                <button
                  type="button"
                  className="link"
                  onClick={() => onNavigate?.(l.uid)}
                  disabled={!onNavigate}
                >
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {deps.esvs.length > 0 ? (
        <>
          <h2>ESVs ({deps.esvs.length})</h2>
          <ul>
            {deps.esvs.map((e) => (
              <li key={e.uid}>
                <button
                  type="button"
                  className="link"
                  onClick={() => onNavigate?.(e.uid)}
                  disabled={!onNavigate}
                >
                  {e.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
