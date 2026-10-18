import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseTaskInput } from "../lib/parse";
import { QuickAdd, toTaskInput } from "./QuickAdd";

const now = new Date(2026, 9, 18, 10, 0);

describe("toTaskInput", () => {
  it("keeps a single time as a deadline by default, or a block when chosen", () => {
    const p = parseTaskInput("Submit proposal tomorrow at 3pm 30m", { now, projects: [] });
    const due = toTaskInput(p, false);
    expect(due).toMatchObject({ dueDate: "2026-10-19", dueTime: "15:00" });
    expect(due.schedStart).toBeUndefined();

    const block = toTaskInput(p, true);
    expect(block.dueDate).toBeNull();
    expect(new Date(block.schedStart!).getHours()).toBe(15);
    expect((+new Date(block.schedEnd!) - +new Date(block.schedStart!)) / 60000).toBe(30);
  });

  it("applies view defaults only when nothing was parsed", () => {
    const plain = parseTaskInput("Laundry", { now, projects: [] });
    expect(toTaskInput(plain, false, { dueDate: "2026-10-18" }).dueDate).toBe("2026-10-18");
    const dated = parseTaskInput("Laundry Friday", { now, projects: [] });
    expect(toTaskInput(dated, false, { dueDate: "2026-10-18" }).dueDate).toBe("2026-10-23");
  });
});

describe("<QuickAdd>", () => {
  it("previews parsed fields and submits on Enter", async () => {
    const onSubmit = vi.fn(async () => true);
    render(<QuickAdd projects={[]} now={now} onSubmit={onSubmit} onCreateProject={async () => null} />);
    const input = screen.getByLabelText("New task");
    fireEvent.change(input, { target: { value: "Study physics for 45 minutes tomorrow" } });
    expect(screen.getByText("45m")).toBeInTheDocument();
    expect(screen.getByText(/Due Tomorrow/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Study physics", estimateMin: 45, dueDate: "2026-10-19" }));
    await vi.waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("offers to schedule an ambiguous time instead", () => {
    render(<QuickAdd projects={[]} now={now} onSubmit={async () => true} onCreateProject={async () => null} />);
    fireEvent.change(screen.getByLabelText("New task"), { target: { value: "Call dentist tomorrow at 3pm" } });
    fireEvent.click(screen.getByText("Schedule a block instead"));
    expect(screen.getByText("Make it a deadline")).toBeInTheDocument();
    expect(screen.getByText(/Tomorrow, 3 PM–3:30 PM/)).toBeInTheDocument();
  });
});
