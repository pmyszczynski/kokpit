import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BookmarkGroupForm from "@/components/BookmarkGroupForm";

beforeEach(() => {
  // jsdom doesn't implement dialog methods. showModal must set `open` so the
  // dialog's contents count as visible for role-based queries; close must
  // dispatch the native "close" event so <dialog onClose> fires.
  HTMLDialogElement.prototype.showModal = vi.fn().mockImplementation(function (
    this: HTMLDialogElement
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn().mockImplementation(function (
    this: HTMLDialogElement
  ) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
});

const noop = vi.fn();

describe("BookmarkGroupForm – rendering", () => {
  it('shows "Add Bookmark Group" for a new group', () => {
    render(
      <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.getByText("Add Bookmark Group")).toBeInTheDocument();
  });

  it("pre-fills fields and links from an existing group", () => {
    render(
      <BookmarkGroupForm
        bookmark={{
          name: "Dev",
          accent: "#7aa2f7",
          style: "compact",
          placement: { group: "Infra", size: "tall" },
          links: [
            { name: "GitHub", url: "https://github.com", abbr: "GH" },
          ],
        }}
        knownGroups={["Infra"]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByText("Edit Bookmark Group")).toBeInTheDocument();
    expect(screen.getByLabelText("Name *")).toHaveValue("Dev");
    expect(screen.getByLabelText("Accent color")).toHaveValue("#7aa2f7");
    expect(screen.getByLabelText("Style")).toHaveValue("compact");
    expect(screen.getByLabelText("Placement group")).toHaveValue("Infra");
    expect(screen.getByLabelText("Placement size")).toHaveValue("tall");
    expect(screen.getByLabelText("Link 1 name")).toHaveValue("GitHub");
    expect(screen.getByLabelText("Link 1 abbreviation")).toHaveValue("GH");
  });

  it("shows a hint that descriptions only render in list style", () => {
    render(
      <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(
      screen.getByText(/Descriptions only render in the .list. style/)
    ).toBeInTheDocument();
  });
});

describe("BookmarkGroupForm – validation", () => {
  it("blocks save when the name is whitespace only", () => {
    const onSave = vi.fn();
    render(
      <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
  });

  it("blocks save when a link has a name but no URL", () => {
    const onSave = vi.fn();
    render(
      <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "GH" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/needs both a name and a URL/)).toBeInTheDocument();
  });

  it("rejects a duplicate group name (case-insensitive)", () => {
    const onSave = vi.fn();
    render(
      <BookmarkGroupForm
        bookmark={null}
        knownGroups={[]}
        takenNames={["Dev"]}
        onSave={onSave}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
  });
});

describe("BookmarkGroupForm – links", () => {
  it("adds and reorders links, and omits empty optional fields on save", () => {
    const onSave = vi.fn();
    render(
      <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Dev" } });

    fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText("Link 1 URL"), {
      target: { value: "https://first.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Add link" }));
    fireEvent.change(screen.getByLabelText("Link 2 name"), { target: { value: "Second" } });
    fireEvent.change(screen.getByLabelText("Link 2 URL"), {
      target: { value: "https://second.com" },
    });

    // Move the second link up so it becomes first.
    fireEvent.click(screen.getByRole("button", { name: "Move link Second up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.links.map((l: { name: string }) => l.name)).toEqual(["Second", "First"]);
    // Empty optional fields are dropped.
    expect(saved.links[0].icon).toBeUndefined();
    expect(saved.links[0].abbr).toBeUndefined();
    expect(saved.links[0].description).toBeUndefined();
  });

  it("removes a link row", () => {
    const onSave = vi.fn();
    render(
      <BookmarkGroupForm
        bookmark={{
          name: "Dev",
          links: [
            { name: "One", url: "https://one.com" },
            { name: "Two", url: "https://two.com" },
          ],
        }}
        knownGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove link One" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0];
    expect(saved.links.map((l: { name: string }) => l.name)).toEqual(["Two"]);
  });

  it("omits style from the payload when it is the default list", () => {
    const onSave = vi.fn();
    render(
      <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "GH" } });
    fireEvent.change(screen.getByLabelText("Link 1 URL"), {
      target: { value: "https://github.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].style).toBeUndefined();
  });
});
