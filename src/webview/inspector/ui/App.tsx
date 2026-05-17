import { useEffect, useState } from "react";
import type { E2W, NodeRef, SelectPayload, W2E } from "../../messages";
import { ConnectionCard } from "./cards/ConnectionCard";
import { InnerJourneyCard } from "./cards/InnerJourneyCard";
import { JourneyCard } from "./cards/JourneyCard";
import { RealmCard } from "./cards/RealmCard";
import { ScriptCard } from "./cards/ScriptCard";

interface VsCodeApi {
  postMessage(msg: W2E): void;
}

interface Props {
  vscode: VsCodeApi;
}

interface DepsState {
  uid: string;
  scripts: NodeRef[];
  inners: NodeRef[];
}

export function App({ vscode }: Props) {
  const [selection, setSelection] = useState<SelectPayload | null>(null);
  const [deps, setDeps] = useState<DepsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onMsg(e: MessageEvent<E2W>) {
      const m = e.data;
      if (m.type === "select") {
        setSelection(m.payload);
        setDeps(null);
        setError(null);
      } else if (m.type === "journeyDeps") {
        setDeps({ uid: m.uid, scripts: m.scripts, inners: m.inners });
      } else if (m.type === "error") {
        setError(m.message);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const navigate = (uid: string) => vscode.postMessage({ type: "navigate", uid });

  if (!selection) {
    return <div className="empty">Select a tree node to inspect.</div>;
  }
  if (error) {
    return <div className="card-error">⚠ {error}</div>;
  }

  // Only attach deps if they belong to the current selection — otherwise the
  // previous fetch's results might briefly flash for a new node.
  const matchingDeps = deps && deps.uid === selection.uid ? deps : null;

  switch (selection.kind) {
    case "connection":
      return <ConnectionCard payload={selection} />;
    case "realm":
      return <RealmCard payload={selection} />;
    case "journey":
      return <JourneyCard payload={selection} deps={matchingDeps} onNavigate={navigate} />;
    case "innerJourney":
      return <InnerJourneyCard payload={selection} deps={matchingDeps} onNavigate={navigate} />;
    case "script":
      return <ScriptCard payload={selection} />;
    case "message":
      return <div className="empty">{selection.label}</div>;
  }
}
