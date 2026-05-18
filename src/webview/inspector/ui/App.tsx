import { useEffect, useState } from "react";
import type { E2W, NodeInfo, NodeRef, SelectPayload, W2E } from "../../messages";
import { ConnectionCard } from "./cards/ConnectionCard";
import { EmailTemplateCard } from "./cards/EmailTemplateCard";
import { EsvCard } from "./cards/EsvCard";
import { InnerJourneyCard } from "./cards/InnerJourneyCard";
import { JourneyCard } from "./cards/JourneyCard";
import { LibraryScriptCard } from "./cards/LibraryScriptCard";
import { RealmCard } from "./cards/RealmCard";
import { ScriptCard } from "./cards/ScriptCard";
import { SocialIdpCard } from "./cards/SocialIdpCard";
import { ThemeCard } from "./cards/ThemeCard";

interface VsCodeApi {
  postMessage(msg: W2E): void;
}

interface Props {
  vscode: VsCodeApi;
}

interface JourneyDepsState {
  uid: string;
  scripts: NodeRef[];
  inners: NodeRef[];
  themes: NodeRef[];
  emailTemplates: NodeRef[];
  socialIdps: NodeRef[];
  nodeIndex: Record<string, NodeInfo>;
}

export interface ScriptDepsState {
  uid: string;
  libraryScripts: NodeRef[];
  esvs: NodeRef[];
}

export function App({ vscode }: Props) {
  const [selection, setSelection] = useState<SelectPayload | null>(null);
  const [journeyDeps, setJourneyDeps] = useState<JourneyDepsState | null>(null);
  const [scriptDeps, setScriptDeps] = useState<ScriptDepsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onMsg(e: MessageEvent<E2W>) {
      const m = e.data;
      if (m.type === "select") {
        setSelection(m.payload);
        setJourneyDeps(null);
        setScriptDeps(null);
        setError(null);
      } else if (m.type === "journeyDeps") {
        setJourneyDeps({
          uid: m.uid,
          scripts: m.scripts,
          inners: m.inners,
          themes: m.themes,
          emailTemplates: m.emailTemplates,
          socialIdps: m.socialIdps,
          nodeIndex: m.nodeIndex,
        });
      } else if (m.type === "scriptDeps") {
        setScriptDeps({ uid: m.uid, libraryScripts: m.libraryScripts, esvs: m.esvs });
      } else if (m.type === "error") {
        setError(m.message);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const navigate = (uid: string) => vscode.postMessage({ type: "navigate", uid });
  const openBody = (host: string, realm: string, scriptId: string, language?: string) =>
    vscode.postMessage({ type: "openScriptBody", host, realm, scriptId, language });

  if (!selection) {
    return <div className="empty">Select a tree node to inspect.</div>;
  }
  if (error) {
    return <div className="card-error">⚠ {error}</div>;
  }

  // Only attach deps if they belong to the current selection — otherwise the
  // previous fetch's results might briefly flash for a new node.
  const matchingJourneyDeps = journeyDeps && journeyDeps.uid === selection.uid ? journeyDeps : null;
  const matchingScriptDeps = scriptDeps && scriptDeps.uid === selection.uid ? scriptDeps : null;

  switch (selection.kind) {
    case "connection":
      return <ConnectionCard payload={selection} />;
    case "realm":
      return <RealmCard payload={selection} />;
    case "journey":
      return (
        <JourneyCard
          payload={selection}
          deps={matchingJourneyDeps}
          onNavigate={navigate}
          onOpenBody={openBody}
        />
      );
    case "innerJourney":
      return (
        <InnerJourneyCard
          payload={selection}
          deps={matchingJourneyDeps}
          onNavigate={navigate}
          onOpenBody={openBody}
        />
      );
    case "script":
      return (
        <ScriptCard
          payload={selection}
          deps={matchingScriptDeps}
          onNavigate={navigate}
          onOpenBody={openBody}
        />
      );
    case "libraryScript":
      return (
        <LibraryScriptCard
          payload={selection}
          deps={matchingScriptDeps}
          onNavigate={navigate}
          onOpenBody={openBody}
        />
      );
    case "esv":
      return <EsvCard payload={selection} />;
    case "theme":
      return <ThemeCard payload={selection} />;
    case "emailTemplate":
      return <EmailTemplateCard payload={selection} />;
    case "socialIdp":
      return <SocialIdpCard payload={selection} />;
    case "message":
      return <div className="empty">{selection.label}</div>;
  }
}
