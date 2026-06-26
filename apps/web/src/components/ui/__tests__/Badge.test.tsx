import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, ScoreBadge, StatusBadge } from "../Badge";

describe("Badge family", () => {
  it("renders a plain badge with its children", () => {
    render(<Badge variant="royal">Beta</Badge>);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("StatusBadge renders the humanized stage label", () => {
    render(<StatusBadge status="post_close" />);
    expect(screen.getByText("Post-Close")).toBeInTheDocument();
  });

  it("ScoreBadge renders the score as a percentage", () => {
    render(<ScoreBadge score={87} />);
    expect(screen.getByText("87%")).toBeInTheDocument();
  });
});
