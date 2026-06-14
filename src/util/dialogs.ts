/**
 * The single user-prompt surface (D44). Every "the tool needs a decision from
 * you" moment goes through a **native modal** — centered, dims the editor,
 * blocks until answered — so confirmations look and behave identically across
 * the extension. VS Code adds the trailing `Cancel` button automatically.
 *
 * The only prompts that are NOT routed here are the two a modal physically
 * can't express: `withProgress` (a running progress bar) and `showInputBox`
 * (typed free-text, e.g. a secret value). QuickPick is retired (D44).
 */

import * as vscode from "vscode";

/**
 * Ask the user to confirm a single action. Returns `true` only when they click
 * `verb`; Escape / Cancel / dismissal → `false`. `detail` is the explanatory
 * paragraph shown under the bold `title`.
 */
export async function confirm(title: string, detail: string, verb: string): Promise<boolean> {
  const pick = await vscode.window.showWarningMessage(title, { modal: true, detail }, verb);
  return pick === verb;
}

/**
 * Ask the user to choose among 2–3 mutually exclusive options (e.g. export
 * depth). Buttons appear in the given order; a modal has a single `detail`
 * paragraph, so explain every option there. Returns the chosen verb, or
 * `undefined` when dismissed.
 */
export function chooseModal(
  title: string,
  detail: string,
  ...verbs: string[]
): Thenable<string | undefined> {
  return vscode.window.showWarningMessage(title, { modal: true, detail }, ...verbs);
}
