import type { ResolvedNode } from "../../../../domain/resolved-graph";
import type { Journey } from "../../../../domain/types";
import type { NodeInfo, NodeRef, SelectPayload } from "../../../messages";
import { JourneyDiagram } from "../diagram/JourneyDiagram";
import { ResolvedView, type ResolveState } from "./ResolvedView";

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
  /** D35 — resolver-result state for the Full / Flat views. */
  resolved: ResolveState;
  /** Card-internal hyperlink clicks go through here per D24 — opens the
   * target's card in the preview panel beside; main inspector + tree stay
   * put. */
  onPreview: (uid: string) => void;
  /** Triggered when the user switches to Full or Flat with `resolved.status
   * === "idle"`. Parent posts the `resolveFull` W2E and updates `resolved`. */
  onResolve: () => void;
  /** Triggered when the user clicks the per-card refresh button. Parent
   * posts `refreshResolved` W2E. */
  onRefresh: () => void;
  /** Triggered when a Full / Flat tree row is clicked. Parent posts a
   * `previewResolved` W2E with the descriptor — the extension builds the
   * right `PaicNode` and spawns a fresh tab (resolver keys don't match
   * the sidebar's `uidIndex`). */
  onPreviewResolved: (node: ResolvedNode) => void;
}

export function JourneyCard({
  payload,
  deps,
  resolved,
  onPreview,
  onResolve,
  onRefresh,
  onPreviewResolved,
}: Props) {
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
      <ResolvedView
        directContent={<DepsBlock deps={deps} onPreview={onPreview} />}
        resolved={resolved}
        onResolve={onResolve}
        onRefresh={onRefresh}
        onPreviewResolved={onPreviewResolved}
      />
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
  // Canonical order: Inner journeys → Scripts → Themes → Email templates →
  // Social IdPs (matches the sidebar / Full / Flat ordering).
  const sections: Array<{ label: string; icon: string; items: NodeRef[] }> = [
    { label: "Inner journeys", icon: "type-hierarchy-sub", items: deps.inners },
    { label: "Scripts", icon: "symbol-method", items: deps.scripts },
    { label: "Themes", icon: "paintcan", items: deps.themes },
    { label: "Email templates", icon: "mail", items: deps.emailTemplates },
    { label: "Social IdPs", icon: "link-external", items: deps.socialIdps },
  ];
  const populated = sections.filter((s) => s.items.length > 0);
  if (populated.length === 0) {
    return (
      <section className="deps-empty">
        <em>No dependencies discovered.</em>
      </section>
    );
  }
  return (
    <section className="deps">
      <ul className="deps-flat">
        {populated.flatMap((s) => [
          <li key={`d:${s.label}`} className="deps-flat-divider">
            ── {s.label} ({s.items.length}) ──
          </li>,
          ...sortByLabel(s.items).map((i) => (
            <li key={i.uid} className="deps-flat-row">
              <button type="button" className="link" onClick={() => onPreview(i.uid)}>
                <i className={`codicon codicon-${s.icon} deps-icon`} aria-hidden />
                <span className="deps-name"> {i.label}</span>
              </button>
            </li>
          )),
        ])}
      </ul>
    </section>
  );
}

function sortByLabel(items: readonly NodeRef[]): NodeRef[] {
  return [...items].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
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
