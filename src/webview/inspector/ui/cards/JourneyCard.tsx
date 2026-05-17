import type { NodeRef, SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "journey" }>;
  deps: { scripts: NodeRef[]; inners: NodeRef[] } | null;
  onNavigate: (uid: string) => void;
}

export function JourneyCard({ payload, deps, onNavigate }: Props) {
  const { journey, realmName, host } = payload;
  const nodeCount = Object.keys(journey.nodes).length;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Journey</span>
        <h1>{journey.id}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Realm</dt>
        <dd>{realmName}</dd>
        <dt>Status</dt>
        <dd>{journey.enabled ? "Enabled" : "Disabled"}</dd>
        {journey.description ? (
          <>
            <dt>Description</dt>
            <dd>{journey.description}</dd>
          </>
        ) : null}
        {journey.identityResource ? (
          <>
            <dt>Identity Resource</dt>
            <dd>
              <code>{journey.identityResource}</code>
            </dd>
          </>
        ) : null}
        <dt>Entry node</dt>
        <dd>
          <code>{journey.entryNodeId}</code>
        </dd>
        <dt>Node count</dt>
        <dd>{nodeCount}</dd>
      </dl>
      <DepsBlock deps={deps} onNavigate={onNavigate} />
    </article>
  );
}

interface DepsProps {
  deps: { scripts: NodeRef[]; inners: NodeRef[] } | null;
  onNavigate: (uid: string) => void;
}

export function DepsBlock({ deps, onNavigate }: DepsProps) {
  if (!deps) {
    return (
      <section className="deps-loading">
        <em>Resolving dependencies…</em>
      </section>
    );
  }
  if (deps.scripts.length === 0 && deps.inners.length === 0) {
    return (
      <section className="deps-empty">
        <em>No script or inner-tree dependencies.</em>
      </section>
    );
  }
  return (
    <section className="deps">
      {deps.scripts.length > 0 ? (
        <>
          <h2>Scripts ({deps.scripts.length})</h2>
          <ul>
            {deps.scripts.map((s) => (
              <li key={s.uid}>
                <button type="button" className="link" onClick={() => onNavigate(s.uid)}>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {deps.inners.length > 0 ? (
        <>
          <h2>Inner journeys ({deps.inners.length})</h2>
          <ul>
            {deps.inners.map((i) => (
              <li key={i.uid}>
                <button type="button" className="link" onClick={() => onNavigate(i.uid)}>
                  {i.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
