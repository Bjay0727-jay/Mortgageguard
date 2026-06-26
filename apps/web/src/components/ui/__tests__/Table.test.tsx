import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table, type Column } from "../Table";

interface Row { id: string; name: string; state: string }
const DATA: Row[] = [
  { id: "1", name: "Acme Loan", state: "TX" },
  { id: "2", name: "Beta Loan", state: "CA" },
];
const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "state", header: "State", render: (r) => r.state },
];

describe("Table (responsive)", () => {
  it("renders an accessible <table> with a caption for desktop", () => {
    render(<Table columns={COLUMNS} data={DATA} rowKey={(r) => r.id} caption="Loans" />);
    const table = screen.getByRole("table", { name: "Loans" });
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    // header cells use scope=col for screen-reader column association
    within(table).getAllByRole("columnheader").forEach((th) => expect(th).toHaveAttribute("scope", "col"));
  });

  it("also renders a stacked card list (mobile layout) with every row", () => {
    const { container } = render(<Table columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />);
    // the mobile layout is a <ul> of cards hidden at md+ via CSS
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll("li")).toHaveLength(2);
    // each value appears in both the table and the card list
    expect(screen.getAllByText("Acme Loan").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the empty state instead of a table when there is no data", () => {
    render(<Table columns={COLUMNS} data={[]} rowKey={(r) => r.id} emptyState={<p>Nothing here</p>} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("activates a clickable row via keyboard (Enter)", async () => {
    const onRowClick = vi.fn();
    render(<Table columns={COLUMNS} data={DATA} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const rows = screen.getAllByRole("button");
    rows[0].focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(DATA[0]);
  });
});
