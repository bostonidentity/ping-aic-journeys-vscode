import type { SelectPayload } from "../../../messages";
import { JourneyDiagram } from "../diagram/JourneyDiagram";
import { DepsBlock, type JourneyCardDeps } from "./JourneyCard";

interface Props {
  payload: Extract<SelectPayload, { kind: "innerJourney" }>;
  deps: JourneyCardDeps | null;
  onNavigate: (uid: string) => void;
  onOpenBody: (host: string, realm: string, scriptId: string, language?: string) => void;
}

export function InnerJourneyCard({ payload, deps, onNavigate, onOpenBody }: Props) {
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
      {deps?.nodeIndex && nodeCount > 0 ? (
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
