import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServiceForm from "@/components/ServiceForm";
import { UnsavedChangesProvider } from "@/components/unsaved/UnsavedChangesProvider";
import type { Service } from "@/config/schema";
import { WIDGET_CONFIG_REFERENCE_PREFIX } from "@/widgets/secretReference";

vi.mock("next/navigation", () => {
  const router = { refresh: vi.fn() };
  return { useRouter: () => router };
});

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-config-revision": "revision-1" } })));
});

function RecoverableForm({ service, onSave }: { service: Service; onSave: (saved: Service) => void }) {
  const [visible, setVisible] = useState(true);
  return <>
    <button onClick={() => setVisible(!visible)}>History traversal</button>
    {visible && <ServiceForm service={service} existingGroups={[]} baselineRevision="revision-1" onSave={onSave} onClose={() => undefined} />}
  </>;
}

function setup(service: Service) {
  const onSave = vi.fn();
  render(<UnsavedChangesProvider><RecoverableForm service={service} onSave={onSave} /></UnsavedChangesProvider>);
  return onSave;
}

async function recover() {
  fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
  expect(screen.getByText(/Recovered basic service fields/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
}

describe("ServiceForm recovered widget state", () => {
  it("uses the recovered type's editor defaults instead of the saved type's options", async () => {
    const onSave = setup({
      tileId: "20000000-0000-4000-8000-000000000001", name: "Saved search",
      widget: { type: "search", config: { search_url: "https://search.example/", engine_name: "Private search", new_tab: false } },
    });
    fireEvent.change(screen.getByLabelText("Tile type"), { target: { value: "system-stats" } });
    fireEvent.change(screen.getByLabelText("Footprint"), { target: { value: "3x4" } });
    fireEvent.change(screen.getByLabelText("Refresh interval (ms)"), { target: { value: "30000" } });
    await recover();
    expect(screen.getByLabelText("Tile type")).toHaveValue("system-stats");
    expect(screen.getByLabelText("Footprint")).toHaveValue("3x4");
    expect(screen.getByLabelText("Refresh interval (ms)")).toHaveValue(30000);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      footprint: { columnSpan: 3, rowSpan: 4 },
      widget: { type: "system-stats", config: { size_defaults: true }, refresh_interval_ms: 30000 },
    }));
  });

  it("preserves the saved options when recovery keeps the same known type", async () => {
    const widget = { type: "search", config: { search_url: "https://search.example/", query_parameter: "query", engine_name: "Saved engine", new_tab: false } };
    const onSave = setup({ tileId: "20000000-0000-4000-8000-000000000002", name: "Saved search", widget });
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Recovered search" } });
    await recover();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Recovered search", widget }));
  });

  it("preserves an unchanged unknown widget's opaque configuration and intent", async () => {
    const widget = {
      type: "future-widget", config: { __kokpit_widget_config_reference__: `${WIDGET_CONFIG_REFERENCE_PREFIX}saved-widget` },
      fields: ["summary"], refresh_interval_ms: 12_000,
    };
    const onSave = setup({ tileId: "20000000-0000-4000-8000-000000000003", name: "Saved unknown", widget });
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Recovered unknown" } });
    await recover();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Recovered unknown", widget }));
  });
});
