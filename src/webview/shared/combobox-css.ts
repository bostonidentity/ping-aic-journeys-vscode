/**
 * CSS for the shared `Combobox` (D38). Each webview panel hand-rolls its own
 * `<style>` string, so the combobox styles ship as this const that every
 * consuming panel (`search`, `transfer`, …) concatenates into its stylesheet.
 * Covers the base `input` styling the combobox relies on plus the
 * `.entity-combobox*` rules.
 */
export const COMBOBOX_CSS = `
  input {
    padding: 4px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    width: 100%;
    box-sizing: border-box;
  }
  input:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .entity-combobox {
    position: relative;
  }
  /* The field box — the chevron anchors HERE, not to .entity-combobox
     (which grows tall when the popup opens, dragging the chevron down). */
  .entity-combobox-field {
    position: relative;
  }
  /* Chevron — the affordance that makes the input read as a dropdown, not a
     text field. Sits inside the box, on the right, like a native <select>. */
  .entity-combobox-chevron {
    position: absolute;
    right: 6px;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    pointer-events: none;
    font-size: 14px;
    color: var(--vscode-foreground);
    opacity: 0.8;
  }
  .entity-combobox-field input {
    /* room for the chevron */
    padding-right: 24px;
  }
  /* When the popup is open, square the input's bottom corners so the box +
     list visually fuse into one dropdown. */
  .entity-combobox.open input {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  /* Popup sits FLUSH under the input (overlapping its 1px border) and uses
     the native dropdown's own widget colours + a subtle shadow — so the box +
     list read as one control, like a native <select>. */
  .entity-combobox-list {
    position: absolute;
    z-index: 10;
    left: 0;
    right: 0;
    top: 100%;
    margin-top: -1px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-focusBorder);
    border-top-color: var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
    border-radius: 0 0 4px 4px;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.36);
  }
  .entity-combobox-option {
    padding: 5px 10px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .entity-combobox-option:hover,
  .entity-combobox-option.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .entity-combobox-empty {
    padding: 5px 10px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
`;
