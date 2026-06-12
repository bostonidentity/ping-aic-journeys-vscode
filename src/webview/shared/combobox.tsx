import { useEffect, useMemo, useRef, useState } from "react";

/** One selectable option in a `Combobox`. `value` is the stable identity the
 * caller stores; `label` is the displayed + filtered-on text. */
export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * Type-to-filter dropdown — the single dropdown primitive for every webview
 * `<select>` (D38). Shared across surfaces; relies on the `COMBOBOX_CSS`
 * rules being injected into the host panel's stylesheet.
 *
 * An input + an HTML-drawn popup: because the popup is our own markup it
 * honors the VS Code theme (dark in dark mode), unlike a native `<select>`
 * whose open list the OS draws. Typing narrows the popup by case-insensitive
 * substring on `label`; empty input shows every option.
 *
 * `id` must be unique per instance on the page — it scopes the
 * `aria-controls` / option ids.
 */
export function Combobox({
  id,
  options,
  selectedValue,
  onSelect,
  placeholder = "Type to filter…",
  disabled = false,
  emptyLabel = "No matches",
}: {
  id: string;
  options: readonly ComboboxOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the input text in sync when the selection changes from outside
  // (a dependent dropdown clears it, a card-portal prefill sets it).
  const selectedLabel = options.find((o) => o.value === selectedValue)?.label ?? "";
  useEffect(() => {
    setText(selectedLabel);
  }, [selectedLabel]);

  const matches = useMemo(() => {
    const needle = text.trim().toLocaleLowerCase();
    if (needle.length === 0) return options;
    return options.filter((o) => o.label.toLocaleLowerCase().includes(needle));
  }, [options, text]);

  // Close the popup on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (o: ComboboxOption) => {
    onSelect(o.value);
    setText(o.label);
    setOpen(false);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (ev.key === "Enter" && open && matches[active]) {
      ev.preventDefault();
      choose(matches[active]);
    }
  };

  // Active option id for `aria-activedescendant` — in the ARIA combobox
  // pattern focus stays on the input; the highlighted option is announced
  // by id rather than being tab-focusable itself.
  const optId = (value: string) => `${id}-opt-${value}`;
  const activeId = open && matches[active] ? optId(matches[active].value) : undefined;

  return (
    <div className={`entity-combobox${open ? " open" : ""}`} ref={rootRef}>
      {/* Field wrapper — the chevron is positioned against THIS box only,
          not the whole combobox (which grows tall when the popup opens). */}
      <div className="entity-combobox-field">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          aria-activedescendant={activeId}
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (e.target.value.trim() === "") onSelect("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <i
          className={`codicon codicon-chevron-${open ? "up" : "down"} entity-combobox-chevron`}
          aria-hidden
        />
      </div>
      {open && !disabled ? (
        // Generic `div`s carry the listbox/option roles — focus stays on the
        // input (ARIA combobox pattern), so the options are not tab-focusable;
        // `aria-activedescendant` announces the highlight.
        <div id={`${id}-listbox`} className="entity-combobox-list" role="listbox">
          {matches.length === 0 ? (
            <div className="entity-combobox-empty">{emptyLabel}</div>
          ) : (
            matches.map((o, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: ARIA combobox pattern — focus stays on the input; the option is announced via aria-activedescendant, not tab-focused
              <div
                key={o.value}
                id={optId(o.value)}
                role="option"
                aria-selected={o.value === selectedValue}
                className={`entity-combobox-option${i === active ? " active" : ""}`}
                onMouseDown={(ev) => {
                  // mousedown, not click — fires before the input blur.
                  ev.preventDefault();
                  choose(o);
                }}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
