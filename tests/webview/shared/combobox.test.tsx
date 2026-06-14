// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxOption } from "@/webview/shared/combobox";

const OPTIONS: ComboboxOption[] = [
  { value: "a", label: "alpha-login" },
  { value: "b", label: "beta-register" },
  { value: "c", label: "helpers" },
];

function setup(selectedValue = "") {
  const onSelect = vi.fn();
  render(<Combobox id="cb" options={OPTIONS} selectedValue={selectedValue} onSelect={onSelect} />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  return { onSelect, input };
}

describe("Combobox", () => {
  it("shows every option on focus when nothing is typed", () => {
    setup();
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters by case-insensitive substring as the user types", () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "REGIST" } });
    expect(screen.getByRole("option", { name: "beta-register" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "helpers" })).toBeNull();
  });

  // The reported bug: after a selection, reopening must list EVERY option again,
  // not just the one whose label currently sits in the box.
  it("lists all options again when reopened after a selection", () => {
    const { input } = setup("b"); // beta-register is the committed selection
    expect(input.value).toBe("beta-register");
    fireEvent.focus(input);
    // Without the showAll fix only "beta-register" would match the box text.
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("stops showing all and filters once the user starts typing", () => {
    const { input } = setup("b");
    fireEvent.focus(input); // showAll → all 3
    fireEvent.change(input, { target: { value: "alpha" } });
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(screen.getByRole("option", { name: "alpha-login" })).toBeTruthy();
  });

  it("reverts unselected typing back to the selection on outside click", () => {
    const { input, onSelect } = setup("b");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.mouseDown(document.body); // click outside the combobox
    expect(input.value).toBe("beta-register"); // reverted, not the abandoned "zzz"
    expect(onSelect).not.toHaveBeenCalled(); // abandoning never commits a selection
  });

  it("selecting an option commits its value and fills the box", () => {
    const { input, onSelect } = setup();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: "helpers" }));
    expect(onSelect).toHaveBeenCalledWith("c");
    expect(input.value).toBe("helpers");
  });

  it("clearing the input commits an empty selection", () => {
    const { input, onSelect } = setup("b");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(onSelect).toHaveBeenCalledWith("");
  });
});
