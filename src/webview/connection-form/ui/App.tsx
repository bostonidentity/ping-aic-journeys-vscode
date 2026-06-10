import { useEffect, useRef, useState } from "react";
import type { ConnectionFormData, ConnectionFormPayload, E2W, W2E } from "../messages";

interface VsCodeApi {
  postMessage(msg: W2E): void;
}

interface Props {
  vscode: VsCodeApi;
  payload: ConnectionFormPayload;
}

type ValidateResultState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "ok"; expiresIn?: number; droppedScopes?: string[] }
  | { state: "err"; message: string };

interface FieldErrors {
  host?: string;
  saId?: string;
  jwk?: string;
  username?: string;
  password?: string;
}

type Kind = "paic" | "onprem";

export function App({ vscode, payload }: Props) {
  const isEdit = payload.mode === "edit";
  const initial = payload.initial;

  const [kind, setKind] = useState<Kind>(initial?.kind ?? "paic");
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  // PAIC credential fields.
  const [saId, setSaId] = useState(initial?.kind === "paic" ? initial.saId : "");
  const [jwk, setJwk] = useState("");
  // On-prem credential fields.
  const [username, setUsername] = useState(initial?.kind === "onprem" ? initial.username : "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  // Mutable ref tracks the most recently issued Test Connection request id.
  // Used for stale-result filtering inside the (effect-scoped) message
  // listener — a state value would be captured by closure and out-of-date
  // by the time the message arrives.
  const requestIdRef = useRef(0);
  const [result, setResult] = useState<ValidateResultState>({ state: "idle" });

  useEffect(() => {
    const onMsg = (ev: MessageEvent<E2W>) => {
      const m = ev.data;
      if (!m || m.type !== "validateResult") return;
      if (m.requestId !== requestIdRef.current) return;
      if (m.ok) {
        setResult({ state: "ok", expiresIn: m.expiresIn, droppedScopes: m.droppedScopes });
      } else {
        setResult({ state: "err", message: m.message });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  function validate(): ConnectionFormData | null {
    const errs: FieldErrors = {};
    const h = host.trim();
    const n = name.trim();

    if (h) {
      const dup = payload.existingHosts.includes(h) && !(isEdit && payload.initial?.host === h);
      if (dup) errs.host = "A connection with this host already exists.";
    } else {
      errs.host = kind === "onprem" ? "Base URL is required." : "Host is required.";
    }

    if (kind === "paic") {
      const s = saId.trim();
      const j = jwk.trim();
      if (!s) errs.saId = "Service Account ID is required.";
      if (j) {
        try {
          JSON.parse(j);
        } catch {
          errs.jwk = "JWK must be valid JSON.";
        }
      } else if (!isEdit) {
        errs.jwk = "JWK is required.";
      }
      setErrors(errs);
      if (Object.keys(errs).length > 0) return null;
      return { kind: "paic", host: h, saId: s, name: n || undefined, jwk: j || undefined };
    }

    // on-prem — don't trim the password (whitespace may be significant).
    const u = username.trim();
    if (!u) errs.username = "Admin username is required.";
    if (!password && !isEdit) errs.password = "Admin password is required.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return null;
    return {
      kind: "onprem",
      host: h,
      username: u,
      name: n || undefined,
      password: password || undefined,
    };
  }

  const onSave = () => {
    const data = validate();
    if (data) vscode.postMessage({ type: "save", data });
  };

  const onCancel = () => {
    vscode.postMessage({ type: "cancel" });
  };

  const onTest = () => {
    const data = validate();
    if (!data) return;
    const next = requestIdRef.current + 1;
    requestIdRef.current = next;
    setResult({ state: "pending" });
    vscode.postMessage({ type: "validate", data, requestId: next });
  };

  return (
    <>
      <h1>{isEdit ? "Edit Connection" : "Add Connection"}</h1>
      <div className="subtitle">
        {isEdit
          ? "Update this connection's metadata. Leave the secret blank to keep the existing one."
          : "Add a new connection. The secret (JWK or password) is stored in VS Code SecretStorage."}
      </div>

      <div className="field">
        <div className="group-label">Connection type</div>
        <div className="kind-toggle" role="radiogroup" aria-label="Connection type">
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === "paic"}
              disabled={isEdit}
              onChange={() => setKind("paic")}
            />
            PAIC cloud
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === "onprem"}
              disabled={isEdit}
              onChange={() => setKind("onprem")}
            />
            On-prem AM
          </label>
        </div>
        {isEdit && <div className="hint">connection type can't be changed when editing</div>}
      </div>

      <div className="field">
        <label htmlFor="name">
          Display name <span className="hint optional">(optional)</span>
        </label>
        <input
          id="name"
          type="text"
          placeholder="e.g. prod-tenant"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="host">
          {kind === "onprem" ? "Base URL" : "Host"}
          <span className="required">*</span>
        </label>
        <input
          id="host"
          type="text"
          placeholder={
            kind === "onprem"
              ? "http://openam.example.com:8080/am"
              : "openam-tenant.example.forgeblocks.com"
          }
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <div className="hint warn">host is the stable ID; renaming it moves the stored secret</div>
        <div className="error">{errors.host ?? ""}</div>
      </div>

      {kind === "paic" ? (
        <>
          <div className="field">
            <label htmlFor="saId">
              Service Account ID<span className="required">*</span>
            </label>
            <input
              id="saId"
              type="text"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={saId}
              onChange={(e) => setSaId(e.target.value)}
            />
            <div className="error">{errors.saId ?? ""}</div>
          </div>

          <div className="field">
            <label htmlFor="jwk">
              Service Account JWK (JSON)
              {!isEdit && <span className="required">*</span>}
            </label>
            <textarea
              id="jwk"
              spellCheck={false}
              placeholder="Paste the service-account JWK JSON here"
              value={jwk}
              onChange={(e) => setJwk(e.target.value)}
            />
            <div className="hint lock">stored in VS Code SecretStorage</div>
            {isEdit && <div className="hint">leave blank to keep the existing JWK</div>}
            <div className="error">{errors.jwk ?? ""}</div>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="username">
              Admin username<span className="required">*</span>
            </label>
            <input
              id="username"
              type="text"
              placeholder="amadmin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <div className="error">{errors.username ?? ""}</div>
          </div>

          <div className="field">
            <label htmlFor="password">
              Admin password
              {!isEdit && <span className="required">*</span>}
            </label>
            <input
              id="password"
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="hint lock">stored in VS Code SecretStorage</div>
            {isEdit && <div className="hint">leave blank to keep the existing password</div>}
            <div className="error">{errors.password ?? ""}</div>
          </div>
        </>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={onTest}
          disabled={result.state === "pending"}
        >
          Test Connection
        </button>
        <div className="right">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onSave}>
            Save
          </button>
        </div>
      </div>

      {result.state !== "idle" && <ResultBanner result={result} />}
    </>
  );
}

function ResultBanner({ result }: { result: ValidateResultState }) {
  if (result.state === "pending") {
    return <div className="validate-result pending">Testing connection…</div>;
  }
  if (result.state === "ok") {
    const tokenInfo =
      result.expiresIn === undefined ? "" : ` Token valid for ${result.expiresIn}s.`;
    const dropSuffix =
      result.droppedScopes && result.droppedScopes.length > 0
        ? ` (some scopes not granted: ${result.droppedScopes.join(", ")})`
        : "";
    return (
      <div className="validate-result ok">
        ✓ Connected.{tokenInfo}
        {dropSuffix}
      </div>
    );
  }
  if (result.state === "err") {
    return <div className="validate-result err">✗ {result.message}</div>;
  }
  return null;
}
