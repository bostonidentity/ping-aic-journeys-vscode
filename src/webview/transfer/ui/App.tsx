import { Fragment, useCallback, useEffect, useState } from "react";
import { Combobox, type ComboboxOption } from "../../shared/combobox";
import type {
  BundleKind,
  ComponentSummary,
  ComponentVerdict,
  ConnectionInfo,
  E2W,
  ParsedBundle,
  RequiredDepVerdict,
  TransferPayload,
  W2E,
  WriteResult,
} from "../messages";
import { WRITABLE_KINDS } from "../messages";
import { kindMeta, sortByKindThenName } from "./kind-meta";

const isWritableVerdict = (v: ComponentVerdict) => v.status === "new" || v.status === "differs";
const isEsvKind = (k: BundleKind) => k === "variable" || k === "secret";
const verdictKey = (v: ComponentVerdict) => `${v.kind}:${v.id}`;

function importButtonLabel(
  running: boolean,
  selectedN: number,
  createN: number,
  overwriteN: number,
): string {
  if (running) return "Importing…";
  if (selectedN === 0) return "Nothing selected";
  return `Import ${selectedN} selected · ${createN} create · ${overwriteN} overwrite`;
}

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
  | {
      status: "ok";
      verdicts: readonly ComponentVerdict[];
      /** Discovered info-only dependency refs (libs + ESVs) — TD-9. */
      requires: readonly RequiredDepVerdict[];
    }
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
  // TD-8: per-row checkbox selection (keys = `${kind}:${id}`). Seeded to all
  // writable verdicts when a pre-flight arrives; cleared on a target change.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Select-all header (TD-10): add/remove every actionable key at once.
  const toggleAll = useCallback((keys: string[], selectAll: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (selectAll) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

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
        setPreflight({ status: "ok", verdicts: m.verdicts, requires: m.requires });
        // TD-10: selection is opt-in — nothing checked by default. The user
        // accepts suggested actions row by row (or via the select-all header).
        setSelectedKeys(new Set());
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
    setSelectedKeys(new Set()); // drop stale selection; re-seeded when the new preflight lands
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
    vscode.postMessage({
      type: "execute",
      host: selectedHost,
      realm: selectedRealm,
      selected: [...selectedKeys],
    });
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
          selectedKeys={selectedKeys}
          onToggle={toggleKey}
          onToggleAll={toggleAll}
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
  selectedKeys,
  onToggle,
  onToggleAll,
}: {
  preflight: PreflightState;
  bundleKind: BundleKind;
  execute: ExecuteState;
  onExecute: () => void;
  apply: ApplyState;
  onApplyEsv: () => void;
  selectedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], selectAll: boolean) => void;
}) {
  const isWritable = WRITABLE_KINDS.has(bundleKind);
  const verdicts = preflight.status === "ok" ? preflight.verdicts : [];
  const requires = preflight.status === "ok" ? preflight.requires : [];
  const hasAnyWritable = verdicts.some(isWritableVerdict);
  const results = execute.status === "done" ? execute.results : undefined;
  // TD-10: once an import completes the table locks read-only (the result
  // report) until re-armed by a fresh pre-flight (re-select target / new bundle).
  const locked = execute.status === "done";
  // Button counts come from the SELECTED actionable verdicts (TD-10 — selection
  // is opt-in, default none). Live preview of the confirm-modal summary.
  const selected = verdicts.filter((v) => isWritableVerdict(v) && selectedKeys.has(verdictKey(v)));
  const createN = selected.filter((v) => v.status === "new").length;
  const overwriteN = selected.filter((v) => v.status === "differs").length;
  const selectedN = selected.length;
  const allActionableKeys = verdicts.filter(isWritableVerdict).map(verdictKey);
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
        <PlanTable
          verdicts={verdicts}
          requires={requires}
          results={results}
          selectedKeys={selectedKeys}
          locked={locked}
          onToggle={onToggle}
          onToggleAll={(selectAll) => onToggleAll(allActionableKeys, selectAll)}
        />
      ) : null}
      {preflight.status === "ok" && !isWritable ? (
        <p className="transfer-note">Import for {bundleKind} arrives in a later batch.</p>
      ) : null}
      {locked ? (
        <p className="transfer-hint">
          Import complete — this plan is now read-only. Re-select the target or choose another
          bundle to run again.
        </p>
      ) : null}
      {preflight.status === "ok" && isWritable && hasAnyWritable && !locked ? (
        <div className="transfer-actions">
          <button
            type="button"
            onClick={onExecute}
            disabled={execute.status === "running" || selectedN === 0}
          >
            {importButtonLabel(execute.status === "running", selectedN, createN, overwriteN)}
          </button>
        </div>
      ) : null}
      {wroteEsv ? (
        <p className="transfer-note">
          ESV changes aren't live until applied — use the Apply step below.
        </p>
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

// ─── Plan table (TD-8 grid · TD-10 three-phase Status) ───────────────────────

// No Action column. A single Status column tells the whole story across three
// phases: before (comparison) → selected (checked, pre-import) → after (result).
type RowState = "writable" | "noop" | "blocked";

function rowStateOf(v: ComponentVerdict): RowState {
  if (v.status === "new" || v.status === "differs") return "writable";
  if (v.status === "unsupported" || v.status === "error") return "blocked";
  return "noop"; // identical | exists
}

/** Status PHASE 1 — the comparison fact (before any selection). */
function beforeStatus(v: ComponentVerdict): { text: string; cls: string } {
  switch (v.status) {
    case "new":
      return { text: "New", cls: "transfer-v-new" };
    case "differs":
      return { text: "Differs", cls: "transfer-v-diff" };
    case "identical":
      return { text: "Identical", cls: "transfer-v-ok" };
    case "exists":
      return { text: "Present", cls: "transfer-v-muted" };
    case "unsupported":
      return { text: "Unsupported", cls: "transfer-v-bad" };
    case "error":
      return { text: v.message ?? "Error", cls: "transfer-v-bad" };
  }
}

/** Status PHASE 2 — the pending verb shown when an actionable row is checked. */
function selectedStatus(v: ComponentVerdict): { text: string; cls: string } {
  return v.status === "new"
    ? { text: "Create", cls: "transfer-v-ok" }
    : { text: "Overwrite", cls: "transfer-v-diff" };
}

/** Status PHASE 3 — the per-row write outcome after a completed import. */
function afterStatus(r: WriteResult): { text: string; cls: string } {
  switch (r.status) {
    case "created":
      return { text: "Created", cls: "transfer-v-ok" };
    case "overwritten":
      return { text: "Overwritten", cls: "transfer-v-ok" };
    case "skipped":
      return { text: "Skipped", cls: "transfer-v-muted" };
    case "failed":
      return { text: "Failed", cls: "transfer-v-bad" };
  }
}

/** One row in the unified Plan grid — a writable component (verdict) or an
 * info-only discovered dependency (TD-9). Deps are never selectable (the bundle
 * has no body/value to write); they show what must already exist on the target. */
interface PlanRowData {
  key: string;
  /** Toggle key for selectable rows; null for non-selectable (deps, blocked). */
  selectKey: string | null;
  /** "writable" → live checkbox; "noop" → disabled checkbox; "info"/"blocked" → none. */
  rowState: RowState | "info";
  icon: string;
  typeWord: string;
  statusText: string;
  statusCls: string;
  name: string;
  nameNote?: string;
}

/** Resolve the three-phase Status for a verdict row. */
function pickStatus(
  v: ComponentVerdict,
  state: RowState,
  checked: boolean,
  result?: WriteResult,
): { text: string; cls: string } {
  if (result) return afterStatus(result); // phase 3
  if (checked && state === "writable") return selectedStatus(v); // phase 2
  return beforeStatus(v); // phase 1
}

function verdictRowData(v: ComponentVerdict, checked: boolean, result?: WriteResult): PlanRowData {
  const state = rowStateOf(v);
  const { icon, word } = kindMeta(v.kind);
  // Three-phase Status: after-result wins; else the pending verb when checked;
  // else the comparison fact.
  const status = pickStatus(v, state, checked, result);
  return {
    key: verdictKey(v),
    selectKey: state === "blocked" ? null : verdictKey(v),
    rowState: state,
    icon,
    typeWord: word,
    statusText: status.text,
    statusCls: status.cls,
    name: v.displayName,
    nameNote:
      v.targetMatchCount && v.targetMatchCount > 1
        ? `(${v.targetMatchCount} on target)`
        : undefined,
  };
}

function depRowData(d: RequiredDepVerdict): PlanRowData {
  // A library ref shows the Script icon/word; an ESV ref the variable icon.
  const meta = d.kind === "script" ? kindMeta("script") : kindMeta("variable");
  const typeWord = d.kind === "script" ? "Library" : "ESV";
  const present = d.status === "present";
  return {
    key: `dep:${d.kind}:${d.name}`,
    selectKey: null, // info-only — never importable
    rowState: "info",
    icon: meta.icon,
    typeWord,
    statusText: present ? "Present" : "Missing",
    statusCls: present ? "transfer-v-muted" : "transfer-v-bad",
    name: d.name,
    nameNote: present && d.detail ? `(${d.detail})` : undefined,
  };
}

function PlanTable({
  verdicts,
  requires,
  results,
  selectedKeys,
  locked,
  onToggle,
  onToggleAll,
}: {
  verdicts: readonly ComponentVerdict[];
  requires: readonly RequiredDepVerdict[];
  /** Per-row write outcomes after a run (drives Phase-3 Status + lock). */
  results?: readonly WriteResult[];
  selectedKeys: ReadonlySet<string>;
  /** True once an import has completed — table is read-only until re-armed. */
  locked: boolean;
  onToggle: (key: string) => void;
  onToggleAll: (selectAll: boolean) => void;
}) {
  const resultByKey = new Map((results ?? []).map((r) => [`${r.kind}:${r.id}`, r]));
  // Writable + no-op + blocked components first (type-sorted), then the
  // info-only dependency rows (TD-9) — all in one aligned grid.
  const rows: PlanRowData[] = [
    ...sortByKindThenName(verdicts).map((v) =>
      verdictRowData(v, selectedKeys.has(verdictKey(v)), resultByKey.get(verdictKey(v))),
    ),
    ...requires.map(depRowData),
  ];
  // Tri-state select-all over the actionable (writable) rows only.
  const actionable = rows.filter((r) => r.rowState === "writable");
  const checkedCount = actionable.filter((r) => selectedKeys.has(r.selectKey ?? "")).length;
  const allChecked = actionable.length > 0 && checkedCount === actionable.length;
  const someChecked = checkedCount > 0 && !allChecked;
  return (
    <PlanGrid
      rows={rows}
      selectedKeys={selectedKeys}
      locked={locked}
      onToggle={onToggle}
      headerCheckbox={{
        hasActionable: actionable.length > 0,
        allChecked,
        someChecked,
        onToggleAll,
      }}
    />
  );
}

function PlanGrid({
  rows,
  selectedKeys,
  locked,
  onToggle,
  headerCheckbox,
}: {
  rows: readonly PlanRowData[];
  selectedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  locked: boolean;
  headerCheckbox: {
    hasActionable: boolean;
    allChecked: boolean;
    someChecked: boolean;
    onToggleAll: (selectAll: boolean) => void;
  };
}) {
  return (
    <div className="transfer-plan">
      <div className="transfer-plan-head">
        <span className="plan-check">
          {headerCheckbox.hasActionable ? (
            <input
              type="checkbox"
              aria-label="Select all"
              checked={headerCheckbox.allChecked}
              disabled={locked}
              ref={(el) => {
                if (el) el.indeterminate = headerCheckbox.someChecked;
              }}
              onChange={() => headerCheckbox.onToggleAll(!headerCheckbox.allChecked)}
            />
          ) : null}
        </span>
        <span className="plan-col-head">Type</span>
        <span className="plan-col-head">Status</span>
        <span className="plan-col-head">Name</span>
      </div>
      {rows.map((row) => (
        <PlanRow
          key={row.key}
          row={row}
          checked={row.selectKey !== null && selectedKeys.has(row.selectKey)}
          locked={locked}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function PlanRow({
  row,
  checked,
  locked,
  onToggle,
}: {
  row: PlanRowData;
  checked: boolean;
  locked: boolean;
  onToggle: (key: string) => void;
}) {
  const muted = row.rowState === "noop" || row.rowState === "info";
  const writable = row.rowState === "writable";
  let rowCls = "transfer-plan-row";
  if (muted) rowCls += " is-noop";
  else if (row.rowState === "blocked") rowCls += " is-blocked";
  return (
    <div className={rowCls}>
      <span className="plan-check">
        {/* Uniform column (TD-10): every non-actionable row shows a disabled,
            unchecked box; only New/Differs rows are live. */}
        <input
          type="checkbox"
          checked={writable ? checked : false}
          disabled={!writable || locked}
          aria-label={`Import ${row.name}`}
          onChange={() => row.selectKey && onToggle(row.selectKey)}
        />
      </span>
      <span className="plan-type">
        <i className={`codicon codicon-${row.icon}`} aria-hidden /> {row.typeWord}
      </span>
      <span className={`plan-status ${row.statusCls}`}>{row.statusText}</span>
      <span className="plan-name">
        {row.name}
        {row.nameNote ? <span className="transfer-comp-detail"> {row.nameNote}</span> : null}
      </span>
    </div>
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
