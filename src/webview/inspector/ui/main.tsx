import { createRoot } from "react-dom/client";
import type { W2E } from "../../messages";
import { App } from "./App";

/** Handle to the host given out by `acquireVsCodeApi()`. We type only what we use. */
interface VsCodeApi {
  postMessage(msg: W2E): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VsCodeApi;
  }
}

const vscode = window.acquireVsCodeApi();
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App vscode={vscode} />);
  vscode.postMessage({ type: "ready" });
}
