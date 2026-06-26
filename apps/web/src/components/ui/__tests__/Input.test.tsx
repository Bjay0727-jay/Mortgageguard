import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "../Input";

describe("Input", () => {
  it("associates the label with the control", () => {
    render(<Input label="Email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("marks invalid + wires aria-describedby to the error message", () => {
    render(<Input label="Email" error="Required field" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Required field");
  });

  it("uses aria-label when rendered without a visible label", () => {
    render(<Input aria-label="Search loans" />);
    expect(screen.getByRole("textbox", { name: "Search loans" })).toBeInTheDocument();
  });
});
