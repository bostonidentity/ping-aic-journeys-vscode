import type { Journey } from "../../../../domain/types";
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
  /** Card-internal hyperlink clicks go through here per D24 — opens the
   * target's card in the preview panel beside; main inspector + tree stay
   * put. */
  onPreview: (uid: string) => void;
}

export function JourneyCard({ payload, deps, onPreview }: Props) {
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
        <JourneyFlags journey={journey} />
      </dl>
      {deps?.nodeIndex ? (
        <JourneyDiagram journey={journey} nodeIndex={deps.nodeIndex} onPreview={onPreview} />
      ) : null}
      <DepsBlock deps={deps} onPreview={onPreview} />
    </article>
  );
}

interface DepsProps {
  deps: JourneyCardDeps | null;
  onPreview: (uid: string) => void;
}

export function DepsBlock({ deps, onPreview }: DepsProps) {
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
      <DepsSection title="Scripts" items={deps.scripts} onPreview={onPreview} />
      <DepsSection title="Inner journeys" items={deps.inners} onPreview={onPreview} />
      <DepsSection title="Themes" items={deps.themes} onPreview={onPreview} />
      <DepsSection title="Email templates" items={deps.emailTemplates} onPreview={onPreview} />
      <DepsSection title="Social IdPs" items={deps.socialIdps} onPreview={onPreview} />
    </section>
  );
}

/** Renders the four boolean runtime flags (innerTreeOnly / noSession /
 * mustRun / transactionalOnly) as raw true/false. Per D23: skip rows whose
 * value is undefined; render true/false as-is (no humanization). Exported
 * via implicit module-scope; used by JourneyCard + InnerJourneyCard. */
export function JourneyFlags({ journey }: { journey: Journey }) {
  return (
    <>
      <FlagRow label="innerTreeOnly" value={journey.innerTreeOnly} />
      <FlagRow label="noSession" value={journey.noSession} />
      <FlagRow label="mustRun" value={journey.mustRun} />
      <FlagRow label="transactionalOnly" value={journey.transactionalOnly} />
    </>
  );
}

function FlagRow({ label, value }: { label: string; value: boolean | undefined }) {
  if (value === undefined) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </>
  );
}

function DepsSection({
  title,
  items,
  onPreview,
}: {
  title: string;
  items: NodeRef[];
  onPreview: (uid: string) => void;
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
            <button type="button" className="link" onClick={() => onPreview(i.uid)}>
              {i.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
