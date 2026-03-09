import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ServiceForm from "@/components/ServiceForm";

beforeEach(() => {
  // jsdom does not implement dialog methods; close() must dispatch the
  // native "close" event so that <dialog onClose={...}> fires correctly.
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn().mockImplementation(function (
    this: HTMLDialogElement
  ) {
    this.dispatchEvent(new Event("close"));
  });
});

const noop = vi.fn();

describe("ServiceForm – rendering", () => {
  it('shows "Add Service" for a new service', () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.getByText("Add Service")).toBeInTheDocument();
  });

  it('shows "Edit Service" when editing an existing service', () => {
    render(
      <ServiceForm
        service={{ name: "Jellyfin" }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByText("Edit Service")).toBeInTheDocument();
  });

  it("pre-fills all fields from the existing service", () => {
    render(
      <ServiceForm
        service={{
          name: "Jellyfin",
          url: "http://jellyfin.local",
          description: "Media server",
          group: "Media",
        }}
        existingGroups={["Media"]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Name *")).toHaveValue("Jellyfin");
    expect(screen.getByLabelText("URL")).toHaveValue("http://jellyfin.local");
    expect(screen.getByLabelText("Description")).toHaveValue("Media server");
    expect(screen.getByLabelText("Group")).toHaveValue("Media");
  });
});

describe("ServiceForm – submission", () => {
  it("calls onSave with the entered name", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Sonarr" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Sonarr" }));
  });

  it("omits blank optional fields from the saved payload", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Radarr" },
    });
    fireEvent.click(screen.getByText("Save"));
    const saved = onSave.mock.calls[0][0];
    expect(saved.url).toBeUndefined();
    expect(saved.description).toBeUndefined();
    expect(saved.group).toBeUndefined();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the ✕ button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("GroupCombobox", () => {
  it("shows all existing groups when the input is focused while empty", () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network", "Storage"]}
        onSave={noop}
        onClose={noop}
      />
    );
    fireEvent.focus(screen.getByLabelText("Group"));
    expect(screen.getByText("Media")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
  });

  it("filters suggestions as the user types", () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network", "Storage"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "net" } });
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
    expect(screen.queryByText("Media")).not.toBeInTheDocument();
  });

  it('shows a "Create" option when the typed value is not an existing group', () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Downloads" } });
    expect(screen.getByText(/Create/i)).toBeInTheDocument();
  });

  it('does not show "Create" when value matches an existing group (case-insensitive)', () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "media" } });
    expect(screen.queryByText(/Create/i)).not.toBeInTheDocument();
  });

  it("selecting a suggestion sets the input value and closes the dropdown", () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Network"));
    expect(input).toHaveValue("Network");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("dropdown is hidden when there are no groups and input is empty", () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selected group is included in the onSave payload", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network"]}
        onSave={onSave}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Plex" },
    });
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Media"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Plex", group: "Media" })
    );
  });
});
