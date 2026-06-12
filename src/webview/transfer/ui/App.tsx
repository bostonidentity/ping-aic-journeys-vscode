import { Fragment, useEffect, useState } from "react";
import { Combobox, type ComboboxOption } from "../../shared/combobox";
import type {
  BundleKind,
  ComponentSummary,
  ComponentVerdict,
  ConnectionInfo,
  E2W,
  ParsedBundle,
  TransferPayload,
  W2E,
  WriteResult,
} from "../messages";
import { WRITABLE_KINDS } from "../messages";

const isWritableVerdict = (v: ComponentVerdict) => v.status === "new" || v.status === "differs";
const isEsvKind = (k: BundleKind) => k === "variable" || k === "secret";

interface VsCodeApi {
  postMessage(msg: W2E): void;
}

interface Props {
  vscode: VsCodeApi;
  payload: TransferPayload;
}

interface LoadedBundle {
  fileName: string;
  bundle: ParsedBundle;
}

/** Per-host realm-list fetch state. */
type RealmsState =
  | { status: "loading" }
  | { status: "ok"; realms: readonly string[] }
  | { status: "err"; message: string };

/** Read-only compare pre-flight state. */
type PreflightState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; verdicts: readonly ComponentVerdict[] }
  | { status: "err"; message: string };

/** Write (execute) state. */
type ExecuteState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; results: readonly WriteResult[]; summary?: string };

/** ESV apply state — independent of `execute`, host-scoped (survives a realm
 * change), reset only when the connection changes. */
type ApplyState =
  | { status: "idle" }
  | { status: "running"; host: string; restartStatus: string; elapsedS: number }
  | { status: "done"; host: string; ok: boolean; elapsedS: number; message?: string };

/**
 * Transfer page — Slices A + B1 + B2 (file-first, read-only). Choose an
 * exported bundle, preview it (A), pick a target connection/realm (B1), and see
 * the per-component **pre-flight** comparison (B2: New / Identical / Differs /
 * exists / unsupported). The actual writes land in Slice C.
 */
export function App({ vscode, payload }: Props) {
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [selectedRealm, setSelectedRealm] = useState<string | null>(null);
  const [realmsByHost, setRealmsByHost] = useState<Record<string, RealmsState>>({});
  const [preflight, setPreflight] = useState<PreflightState>({ status: "idle" });
  const [execute, setExecute] = useState<ExecuteState>({ status: "idle" });
  const [apply, setApply] = useState<ApplyState>({ status: "idle" });

  // Announce readiness on mount (the panel re-hydrates the bundle on this).
  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, [vscode]);

  // Listen for extension replies. Re-subscribes when the target changes so the
  // pre-flight handler can drop stale replies for a target since switched.
  useEffect(() => {
    function onMsg(ev: MessageEvent<E2W>) {
      const m = ev.data;
      if (!m || typeof m !== "object" || !("type" in m)) return;
      if (m.type === "bundleLoaded") {
        setError(null);
        setLoaded({ fileName: m.fileName, bundle: m.bundle });
      } else if (m.type === "bundleError") {
        setLoaded(null);
        setError(m.message);
      } else if (m.type === "realmsResult") {
        setRealmsByHost((prev) => ({ ...prev, [m.host]: { status: "ok", realms: m.realms } }));
      } else if (m.type === "realmsError") {
        setRealmsByHost((prev) => ({ ...prev, [m.host]: { status: "err", message: m.message } }));
      } else if (m.type === "preflightResult") {
        if (m.host !== selectedHost || m.realm !== selectedRealm) return; // stale
        setPreflight({ status: "ok", verdicts: m.verdicts });
      } else if (m.type === "preflightError") {
        if (m.host !== selectedHost || m.realm !== selectedRealm) return; // stale
        setPreflight({ status: "err", message: m.message });
      } else if (m.type === "executeResult") {
        if (m.host !== selectedHost || m.realm !== selectedRealm) return; // stale
        setExecute({ status: "done", results: m.results, summary: m.summary });
      } else if (m.type === "applyProgress") {
        if (m.host !== selectedHost) return; // apply is host-scoped (survives realm change)
        setApply({
          status: "running",
          host: m.host,
          restartStatus: m.status,
          elapsedS: m.elapsedS,
        });
      } else if (m.type === "applyResult") {
        if (m.host !== selectedHost) return;
        setApply({
          status: "done",
          host: m.host,
          ok: m.ok,
          elapsedS: m.elapsedS,
          message: m.message,
        });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [selectedHost, selectedRealm]);

  // An apply belongs to a connection — reset it only when the connection
  // changes (NOT on a realm change, unlike the execute log). `selectedHost` is
  // the trigger, not read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-connection-change; selectedHost is the trigger, not a body dependency
  useEffect(() => {
    setApply({ status: "idle" });
  }, [selectedHost]);

  // Fetch the realm list for the selected connection (once per host).
  useEffect(() => {
    if (selectedHost === null) return;
    setRealmsByHost((prev) => {
      if (prev[selectedHost]) return prev; // already fetched / fetching
      vscode.postMessage({ type: "listRealms", host: selectedHost });
      return { ...prev, [selectedHost]: { status: "loading" } };
    });
  }, [selectedHost, vscode]);

  // Run the read-only pre-flight once a leaf bundle + target are both set.
  // Re-runs when the bundle or target changes.
  const isJourney = loaded?.bundle.kind === "journey";
  useEffect(() => {
    setExecute({ status: "idle" }); // a new target/bundle invalidates any prior write log
    if (!loaded || isJourney || selectedHost === null || selectedRealm === null) {
      setPreflight({ status: "idle" });
      return;
    }
    setPreflight({ status: "running" });
    vscode.postMessage({ type: "runPreflight", host: selectedHost, realm: selectedRealm });
  }, [loaded, isJourney, selectedHost, selectedRealm, vscode]);

  const onChoose = () => vscode.postMessage({ type: "pickBundle" });
  const onConnectionChange = (host: string) => {
    setSelectedHost(host === "" ? null : host);
    setSelectedRealm(null);
  };
  const onRealmChange = (realm: string) => setSelectedRealm(realm === "" ? null : realm);
  const onExecute = () => {
    if (selectedHost === null || selectedRealm === null) return;
    setExecute({ status: "running" });
    vscode.postMessage({ type: "execute", host: selectedHost, realm: selectedRealm });
  };
  const onApplyEsv = () => {
    if (selectedHost === null) return;
    setApply({ status: "running", host: selectedHost, restartStatus: "restarting", elapsedS: 0 });
    vscode.postMessage({ type: "applyEsv", host: selectedHost });
  };

  return (
    <main>
      <h1>PAIC Transfer</h1>
      <p className="transfer-subtitle">
        Import a journey or component bundle into a connection. Start by choosing an exported bundle
        to inspect.
      </p>
      <div className="transfer-actions">
        <button type="button" onClick={onChoose}>
          Choose bundle…
        </button>
        {loaded ? <span className="transfer-file">{loaded.fileName}</span> : null}
      </div>
      {error ? <div className="transfer-error">{error}</div> : null}
      {loaded ? <SourcePreview bundle={loaded.bundle} /> : null}
      {!loaded && !error ? <p className="transfer-hint">No bundle loaded yet.</p> : null}
      {loaded && isJourney ? (
        <p className="transfer-note">
          Journey import — target selection &amp; compare arrive in a later batch.
        </p>
      ) : null}
      {loaded && !isJourney ? (
        <TargetSection
          connections={payload.connections}
          selectedHost={selectedHost}
          selectedRealm={selectedRealm}
          realms={selectedHost ? (realmsByHost[selectedHost] ?? null) : null}
          onConnectionChange={onConnectionChange}
          onRealmChange={onRealmChange}
        />
      ) : null}
      {loaded && !isJourney && selectedHost !== null && selectedRealm !== null ? (
        <PlanSection
          preflight={preflight}
          bundleKind={loaded.bundle.kind}
          execute={execute}
          onExecute={onExecute}
          apply={apply}
          onApplyEsv={onApplyEsv}
        />
      ) : null}
    </main>
  );
}

// ─── Target ──────────────────────────────────────────────────────────────────

interface TargetSectionProps {
  connections: readonly ConnectionInfo[];
  selectedHost: string | null;
  selectedRealm: string | null;
  realms: RealmsState | null;
  onConnectionChange: (host: string) => void;
  onRealmChange: (realm: string) => void;
}

function realmOptionsFor(
  realms: RealmsState | null,
  selectedRealm: string | null,
): readonly string[] {
  if (realms?.status === "ok") return realms.realms;
  if (selectedRealm) return [selectedRealm];
  return [];
}

function realmPlaceholder(selectedHost: string | null, realms: RealmsState | null): string {
  if (selectedHost === null) return "— Pick a connection first —";
  if (realms?.status === "loading") return "Loading realms…";
  if (realms?.status === "err") return "Failed to load realms";
  return "— Select a realm —";
}

function TargetSection(props: TargetSectionProps) {
  const { connections, selectedHost, selectedRealm, realms } = props;
  const connectionOptions: ComboboxOption[] = connections.map((c) => ({
    value: c.host,
    label: c.name ? `${c.name} (${c.host})` : c.host,
  }));
  const realmComboOptions: ComboboxOption[] = realmOptionsFor(realms, selectedRealm).map((r) => ({
    value: r,
    label: r,
  }));
  const realmDisabled = selectedHost === null || realms?.status !== "ok";

  return (
    <section>
      <div className="transfer-section-title">Target</div>
      {connections.length === 0 ? (
        <p className="transfer-hint">
          No connections configured. Add one from the PAIC Journeys sidebar first.
        </p>
      ) : (
        <div className="transfer-scope">
          <label htmlFor="target-connection" className="field-label">
            Connection
          </label>
          <Combobox
            id="target-connection"
            options={connectionOptions}
            selectedValue={selectedHost ?? ""}
            onSelect={props.onConnectionChange}
            placeholder="Select a connection…"
          />
          <label htmlFor="target-realm" className="field-label">
            Realm
          </label>
          <Combobox
            id="target-realm"
            options={realmComboOptions}
            selectedValue={selectedRealm ?? ""}
            onSelect={props.onRealmChange}
            placeholder={realmPlaceholder(selectedHost, realms)}
            disabled={realmDisabled}
          />
        </div>
      )}
    </section>
  );
}

// ─── Plan (compare pre-flight) ───────────────────────────────────────────────

function PlanSection({
  preflight,
  bundleKind,
  execute,
  onExecute,
  apply,
  onApplyEsv,
}: {
  preflight: PreflightState;
  bundleKind: BundleKind;
  execute: ExecuteState;
  onExecute: () => void;
  apply: ApplyState;
  onApplyEsv: () => void;
}) {
  const isWritable = WRITABLE_KINDS.has(bundleKind);
  const writableCount =
    preflight.status === "ok" ? preflight.verdicts.filter(isWritableVerdict).length : 0;
  // After an ESV import, offer the separate tenant-wide apply (restart).
  const wroteEsv =
    execute.status === "done" &&
    execute.results.some((r) => isEsvKind(r.kind) && r.status === "created");
  return (
    <section>
      <div className="transfer-section-title">Plan</div>
      {preflight.status === "running" ? <p className="transfer-hint">Checking target…</p> : null}
      {preflight.status === "err" ? (
        <div className="transfer-error">{preflight.message}</div>
      ) : null}
      {preflight.status === "ok" ? (
        <ul className="transfer-compat">
          {preflight.verdicts.map((v) => (
            <VerdictRow key={`${v.kind}:${v.id}`} verdict={v} />
          ))}
        </ul>
      ) : null}
      {preflight.status === "ok" && !isWritable ? (
        <p className="transfer-note">Import for {bundleKind} arrives in a later batch.</p>
      ) : null}
      {preflight.status === "ok" && isWritable && writableCount > 0 ? (
        <div className="transfer-actions">
          <button type="button" onClick={onExecute} disabled={execute.status === "running"}>
            {execute.status === "running"
              ? "Importing…"
              : `Import ${writableCount} component${writableCount === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}
      {execute.status === "done" ? (
        <ExecuteLog results={execute.results} summary={execute.summary} />
      ) : null}
      {wroteEsv && apply.status !== "running" ? (
        <div className="transfer-actions">
          <button type="button" onClick={onApplyEsv}>
            Apply ESV changes
          </button>
        </div>
      ) : null}
      <ApplySection apply={apply} />
    </section>
  );
}

function ApplySection({ apply }: { apply: ApplyState }) {
  if (apply.status === "running") {
    return (
      <p className="transfer-hint">
        Applying ESV changes… {apply.restartStatus} ({apply.elapsedS}s) — a tenant-wide restart,
        usually a few minutes.
      </p>
    );
  }
  if (apply.status === "done") {
    return apply.ok ? (
      <p className="transfer-v-ok">✓ ESV changes applied ({apply.elapsedS}s)</p>
    ) : (
      <p className="transfer-v-bad">
        ✗ ESV apply didn't complete — {apply.message ?? "see logs"} ({apply.elapsedS}s)
      </p>
    );
  }
  return null;
}

function ExecuteLog({ results, summary }: { results: readonly WriteResult[]; summary?: string }) {
  const wroteEsv = results.some((r) => isEsvKind(r.kind) && r.status === "created");
  return (
    <div>
      {results.length > 0 ? (
        <ul className="transfer-compat">
          {results.map((r) => {
            const { label, cls } = resultBadge(r);
            return (
              <li key={`${r.kind}:${r.id}`} className={cls}>
                {label}
              </li>
            );
          })}
        </ul>
      ) : null}
      {summary ? <p className="transfer-hint">{summary}</p> : null}
      {wroteEsv ? (
        <p className="transfer-note">
          ESV changes aren't live until applied — the Apply step lands in a later slice.
        </p>
      ) : null}
    </div>
  );
}

function resultBadge(r: WriteResult): { label: string; cls: string } {
  const name = r.displayName;
  // ESV writes land pending until a separate Apply (restart) — say so.
  const pending = isEsvKind(r.kind) ? " — pending apply" : "";
  switch (r.status) {
    case "created":
      return { label: `✓ ${name} — created${pending}`, cls: "transfer-v-ok" };
    case "overwritten":
      return { label: `✓ ${name} — overwritten`, cls: "transfer-v-ok" };
    case "skipped":
      return { label: `– ${name} — skipped (${r.message ?? ""})`, cls: "transfer-v-muted" };
    case "failed":
      return { label: `✗ ${name} — failed: ${r.message ?? "error"}`, cls: "transfer-v-bad" };
  }
}

function VerdictRow({ verdict }: { verdict: ComponentVerdict }) {
  const { label, cls } = badgeFor(verdict);
  return <li className={cls}>{label}</li>;
}

function badgeFor(v: ComponentVerdict): { label: string; cls: string } {
  const name = v.displayName;
  switch (v.status) {
    case "unsupported":
      return {
        label: `✗ ${name} (${v.kind}) — not supported on on-prem AM`,
        cls: "transfer-v-bad",
      };
    case "new":
      return { label: `✚ ${name} — New (not on target)`, cls: "transfer-v-new" };
    case "identical":
      return { label: `= ${name} — Identical`, cls: "transfer-v-ok" };
    case "differs":
      return { label: `● ${name} — Differs`, cls: "transfer-v-diff" };
    case "exists":
      return { label: `• ${name} — Present (not value-compared)`, cls: "transfer-v-muted" };
    case "error":
      return { label: `⚠ ${name} — ${v.message ?? "error"}`, cls: "transfer-v-bad" };
  }
}

// ─── Source preview (Slice A) ────────────────────────────────────────────────

function SourcePreview({ bundle }: { bundle: ParsedBundle }) {
  const { meta, label, components, inventory } = bundle;
  return (
    <section className="transfer-source">
      <div className="transfer-chip">{label}</div>
      {meta ? (
        <MetaBlock meta={meta} />
      ) : (
        <p className="transfer-hint">No metadata block in this bundle.</p>
      )}
      {inventory.length > 0 ? (
        <ul className="transfer-inventory">
          {inventory.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="transfer-components-header">Components ({components.length})</div>
      <ul className="transfer-components">
        {components.map((c) => (
          <ComponentRow key={`${c.kind}:${c.id}`} component={c} />
        ))}
      </ul>
    </section>
  );
}

function ComponentRow({ component }: { component: ComponentSummary }) {
  return (
    <li>
      <span>{component.displayName}</span>
      {component.detail ? <span className="transfer-comp-detail">{component.detail}</span> : null}
    </li>
  );
}

function MetaBlock({ meta }: { meta: NonNullable<ParsedBundle["meta"]> }) {
  const toolLine =
    meta.exportTool && meta.exportToolVersion
      ? `${meta.exportTool} ${meta.exportToolVersion}`
      : meta.exportTool;
  const rows: Array<[string, string | undefined]> = [
    ["Origin", meta.origin],
    ["Realm", meta.realm],
    ["Type", meta.connectionType],
    ["Exported", meta.exportDate],
    ["Tool", toolLine],
  ];
  return (
    <dl className="transfer-meta">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
    </dl>
  );
}
