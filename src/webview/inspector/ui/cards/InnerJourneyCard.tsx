import type { NodeRef, SelectPayload } from "../../../messages";
import { DepsBlock } from "./JourneyCard";

interface Props {
  payload: Extract<SelectPayload, { kind: "innerJourney" }>;
  deps: { scripts: NodeRef[]; inners: NodeRef[] } | null;
  onNavigate: (uid: string) => void;
}

export function InnerJourneyCard({ payload, deps, onNavigate }: Props) {
  const { journey, realmName, host, visited } = payload;
  const nodeCount = Object.keys(journey.nodes).length;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Inner journey</span>
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
        <dt>Entry node</dt>
        <dd>
          <code>{journey.entryNodeId}</code>
        </dd>
        <dt>Node count</dt>
        <dd>{nodeCount}</dd>
        {visited.length > 0 ? (
          <>
            <dt>Ancestor chain</dt>
            <dd>{visited.join(" → ")}</dd>
          </>
        ) : null}
      </dl>
      <DepsBlock deps={deps} onNavigate={onNavigate} />
    </article>
  );
}
