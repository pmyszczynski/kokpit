import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollapsibleGroup, {
  GROUP_COLLAPSE_STORAGE_PREFIX,
} from "@/components/CollapsibleGroup";

const storageKey = (name: string) => GROUP_COLLAPSE_STORAGE_PREFIX + name;

describe("CollapsibleGroup", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders the group name and its children", () => {
    render(
      <CollapsibleGroup name="Media">
        <div data-testid="tiles">tiles</div>
      </CollapsibleGroup>
    );
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByTestId("tiles")).toBeInTheDocument();
  });

  it("is expanded by default", () => {
    const { container } = render(
      <CollapsibleGroup name="Media">tiles</CollapsibleGroup>
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector(".service-group--collapsed")
    ).toBeNull();
  });

  it("uses the YAML default when nothing is stored", () => {
    const { container } = render(
      <CollapsibleGroup name="Media" defaultCollapsed>
        tiles
      </CollapsibleGroup>
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector(".service-group--collapsed")
    ).not.toBeNull();
  });

  it("prefers the stored per-device state over the YAML default", () => {
    window.localStorage.setItem(storageKey("Media"), "true");
    render(
      <CollapsibleGroup name="Media" defaultCollapsed={false}>
        tiles
      </CollapsibleGroup>
    );
    // localStorage is read in an effect (flushed by RTL's act-wrapped render).
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("stored 'false' re-expands a group whose YAML default is collapsed", () => {
    window.localStorage.setItem(storageKey("Media"), "false");
    render(
      <CollapsibleGroup name="Media" defaultCollapsed>
        tiles
      </CollapsibleGroup>
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("toggling collapses the group and persists the choice per group name", () => {
    const { container } = render(
      <CollapsibleGroup name="Media">tiles</CollapsibleGroup>
    );
    const button = screen.getByRole("button");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector(".service-group--collapsed")
    ).not.toBeNull();
    expect(window.localStorage.getItem(storageKey("Media"))).toBe("true");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem(storageKey("Media"))).toBe("false");
  });

  it("namespaces stored state per group name", () => {
    render(<CollapsibleGroup name="Media">tiles</CollapsibleGroup>);
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(storageKey("Media"))).toBe("true");
    expect(window.localStorage.getItem(storageKey("Other"))).toBeNull();
  });
});
