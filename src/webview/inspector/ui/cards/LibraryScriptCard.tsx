import type { ResolvedNode } from "../../../../domain/resolved-graph";
import type { SelectPayload } from "../../../messages";
import { ResolvedView, type ResolveState } from "./ResolvedView";
import { type ScriptCardDeps, ScriptDepsBlock } from "./ScriptCard";

interface Props {
  payload: Extract<SelectPayload, { kind: "libraryScript" }>;
  deps?: ScriptCardDeps | null;
  resolved: ResolveState;
  onPreview?: (uid: string) => void;
  onResolve: () => void;
  onRefresh: () => void;
  onPreviewResolved: (node: ResolvedNode) => void;
  onOpenBody?: (host: string, realm: string, scriptId: string, language?: string) => void;
}

export function LibraryScriptCard({
  payload,
  deps,
  resolved,
  onPreview,
  onResolve,
  onRefresh,
  onPreviewResolved,
  onOpenBody,
}: Props) {
  const { name, scriptId, host, realmName, script } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Library script</span>
        <h1>{name}</h1>
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
      <ResolvedView
        directContent={<ScriptDepsBlock deps={deps ?? null} onPreview={onPreview} />}
        resolved={resolved}
        onResolve={onResolve}
        onRefresh={onRefresh}
        onPreviewResolved={onPreviewResolved}
      />
    </article>
  );
}
