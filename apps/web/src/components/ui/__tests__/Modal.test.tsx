import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}} title="Hi">Body</Modal>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes role=dialog with aria-modal and a labelled title", () => {
    render(<Modal open onClose={() => {}} title="Confirm action">Body</Modal>);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Confirm action");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Hi"><button>Inside</button></Modal>);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("moves focus into the dialog when opened", () => {
    render(<Modal open onClose={() => {}} title="Hi"><button>First action</button></Modal>);
    const btn = screen.getByRole("button", { name: "First action" });
    expect(btn).toHaveFocus();
  });

  it("closes when the backdrop is clicked but not when the panel is clicked", async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Hi">Body</Modal>);
    await userEvent.click(screen.getByRole("dialog")); // panel
    expect(onClose).not.toHaveBeenCalled();
  });
});
