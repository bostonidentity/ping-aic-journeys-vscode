import type { NodeInfo, NodeRef, SelectPayload } from "../../../messages";
import { JourneyDiagram } from "../diagram/JourneyDiagram";

export interface JourneyCardDeps {
  scripts: NodeRef[];
  inners: NodeRef[];
  themes: NodeRef[];
  emailTemplates: NodeRef[];
  socialIdps: NodeRef[];
  nodeIndex: Record<string, NodeInfo>;
}

interface Props {
  payload: Extract<SelectPayload, { kind: "journey" }>;
  deps: JourneyCardDeps | null;
  onNavigate: (uid: string) => void;
  onOpenBody: (host: string, realm: string, scriptId: string, language?: string) => void;
}

export function JourneyCard({ payload, deps, onNavigate, onOpenBody }: Props) {
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
      {deps?.nodeIndex ? (
        <JourneyDiagram
          journey={journey}
          nodeIndex={deps.nodeIndex}
          host={host}
          realm={realmName}
          onNavigate={onNavigate}
          onOpenBody={onOpenBody}
        />
      ) : null}
      <DepsBlock deps={deps} onNavigate={onNavigate} />
    </article>
  );
}

interface DepsProps {
  deps: JourneyCardDeps | null;
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
  const total =
    deps.scripts.length +
    deps.inners.length +
    deps.themes.length +
    deps.emailTemplates.length +
    deps.socialIdps.length;
  if (total === 0) {
    return (
      <section className="deps-empty">
        <em>No dependencies discovered.</em>
      </section>
    );
  }
  return (
    <section className="deps">
      <DepsSection title="Scripts" items={deps.scripts} onNavigate={onNavigate} />
      <DepsSection title="Inner journeys" items={deps.inners} onNavigate={onNavigate} />
      <DepsSection title="Themes" items={deps.themes} onNavigate={onNavigate} />
      <DepsSection title="Email templates" items={deps.emailTemplates} onNavigate={onNavigate} />
      <DepsSection title="Social IdPs" items={deps.socialIdps} onNavigate={onNavigate} />
    </section>
  );
}

function DepsSection({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NodeRef[];
  onNavigate: (uid: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h2>
        {title} ({items.length})
      </h2>
      <ul>
        {items.map((i) => (
          <li key={i.uid}>
            <button type="button" className="link" onClick={() => onNavigate(i.uid)}>
              {i.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
