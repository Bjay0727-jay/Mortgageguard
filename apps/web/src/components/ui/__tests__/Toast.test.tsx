import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../Toast";

function Trigger() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast({ variant: "success", title: "Saved", description: "All good", duration: 0 })}>
      Notify
    </button>
  );
}

describe("Toast", () => {
  it("shows a toast on demand and lets the user dismiss it", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("All good")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("renders notifications inside a labelled live region", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    // success toasts announce politely via role=status
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});
