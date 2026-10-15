import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("is labelled by its title, focuses inside, wraps Tab and calls onClose on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="My title" onClose={onClose} footer={<button>Save</button>}>
        <input aria-label="name" />
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "My title" })).toBeInTheDocument();

    const close = screen.getByRole("button", { name: /close/i });
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("name")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores already-handled Escape and restores focus on unmount", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const Host = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Modal title="T" onClose={() => { onClose(); setOpen(false); }}>
              <input aria-label="field" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
            </Modal>
          )}
        </>
      );
    };
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    await user.click(screen.getByLabelText("field"));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("dialog"));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
