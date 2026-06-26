import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "../Tabs";

const TABS = [
  { id: "a", label: "First" },
  { id: "b", label: "Second" },
  { id: "c", label: "Third" },
];

/** Stateful host so selection actually advances between key presses. */
function ControlledTabs({ onChange, initial = "a" }: { onChange?: (id: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs
      tabs={TABS}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      aria-label="Sections"
    />
  );
}

describe("Tabs", () => {
  it("renders an accessible tablist with the selected tab marked", () => {
    render(<Tabs tabs={TABS} value="a" onChange={() => {}} aria-label="Sections" />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "First" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("aria-selected", "false");
  });

  it("moves selection with ArrowRight / ArrowLeft and wraps", async () => {
    const onChange = vi.fn();
    render(<ControlledTabs onChange={onChange} />);
    screen.getByRole("tab", { name: "First" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("a");
    await userEvent.keyboard("{ArrowLeft}"); // wraps past the start to the end
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("jumps to last tab with End and first with Home", async () => {
    const onChange = vi.fn();
    render(<ControlledTabs onChange={onChange} />);
    screen.getByRole("tab", { name: "First" }).focus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("only the active tab is in the tab order (roving tabindex)", () => {
    render(<Tabs tabs={TABS} value="b" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "First" })).toHaveAttribute("tabindex", "-1");
  });
});
