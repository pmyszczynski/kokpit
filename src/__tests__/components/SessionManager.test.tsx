import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";
import { useEffect, useState } from "react";
import { UnsavedChangesProvider, useUnsavedChanges, useUnsavedSource } from "@/components/unsaved/UnsavedChangesProvider";
import { ConfigurationSyncProvider } from "@/components/ConfigurationSyncProvider";

const replaceMock = vi.hoisted(() => vi.fn());
const router = { push: pushMock, refresh: refreshMock, replace: replaceMock };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import SessionManager from "@/components/SessionManager";

const sessions = [
  { id: "current", device: "Firefox on macOS", createdAt: 1_700_000_000_000, lastSeenAt: 1_700_000_100_000, current: true },
  { id: "other", device: "Chrome on Linux", createdAt: 1_700_000_000_000, lastSeenAt: 1_700_000_100_000, current: false },
];

function Draft({ onDiscard }: { onDiscard?: () => void }) {
  const [value, setValue] = useState("Retained editor work");
  useUnsavedSource("session-test", { label: "Editor draft", dirty: Boolean(value), version: value, discard: () => { onDiscard?.(); setValue(""); } });
  return <input aria-label="Editor draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

function RetainedDraftProbe() {
  const unsaved = useUnsavedChanges()!;
  const writeRecovery = unsaved.writeRecovery;
  useEffect(() => {
    writeRecovery("settings:session-history", { revision: "one", value: { name: "Retained history work" }, dirty: true, owner: "session-history" });
  }, [writeRecovery]);
  return <output data-testid="retained-session-draft">{unsaved.readRecovery("settings:session-history") ? "retained" : "cleared"}</output>;
}

function protectedManager(onDiscard = vi.fn()) {
  return render(<UnsavedChangesProvider><RetainedDraftProbe />
    <ConfigurationSyncProvider initialRevision="one" initialEditable={true} initialDataRevision="data-one"
      initialAppearance={{ theme: "light", customCss: undefined, bgStyle: { "--app-bg-color": "#123456" } }}>
      <Draft onDiscard={onDiscard} /><SessionManager />
    </ConfigurationSyncProvider>
  </UnsavedChangesProvider>);
}

function protectedFetch(post: () => Promise<Response>, listed = () => sessions) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/config/revision") return new Response(JSON.stringify({ revision: "one", editable: true }));
    if (url === "/api/auth/sessions") {
      if (init?.method === "POST") return post();
      return new Response(JSON.stringify({ sessions: listed() }));
    }
    throw new Error(`Unexpected session-test request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SessionManager", () => {
  beforeEach(() => {
    resetNavigationMock();
    replaceMock.mockReset();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.getElementById("kokpit-custom-css")?.remove(); });

  it("labels the current session and signs it out without a password", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionManager />);
    await screen.findByText(/This device/);

    fireEvent.click(screen.getByRole("button", { name: "Sign out this device" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sessions", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
      body: JSON.stringify({ action: "revoke", sessionId: "current" }),
    }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("requires a password before signing another device out", async () => {
    let listed = sessions;
    const fetchMock = protectedFetch(async () => { listed = [sessions[0]]; return new Response("{}"); }, () => listed);
    const discarded = vi.fn();
    const view = protectedManager(discarded);
    await screen.findByText("Chrome on Linux");

    fireEvent.click(screen.getAllByRole("button", { name: "Sign out device" })[0]);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sessions", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
      body: JSON.stringify({ action: "revoke", sessionId: "other", password: "password" }),
    }));
    await waitFor(() => expect(screen.queryByText("Chrome on Linux")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.container.querySelector(".protected-surface")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Retained editor work");
    expect(screen.getByTestId("retained-session-draft")).toHaveTextContent("retained");
    expect(discarded).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled(); expect(pushMock).not.toHaveBeenCalled();
  });

  it.each([
    { action: "this device", button: "Sign out this device", body: { action: "revoke", sessionId: "current" }, password: false },
    { action: "all devices", button: "Sign out all devices", body: { action: "revoke-all", password: "current-password" }, password: true },
  ])("masks protected content and clears drafts only after successfully signing out $action", async ({ button, body, password }) => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const fetchMock = protectedFetch(() => pending);
    const discarded = vi.fn();
    const view = protectedManager(discarded);
    await screen.findByText(/This device/);
    fireEvent.click(screen.getByRole("button", { name: button }));
    if (password) fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Retained editor work");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
    expect(view.container.querySelector(".protected-surface")).toBeVisible();
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Retained editor work");
    expect(screen.getByTestId("retained-session-draft")).toHaveTextContent("retained");
    expect(discarded).not.toHaveBeenCalled(); expect(replaceMock).not.toHaveBeenCalled();
    await act(async () => { complete(new Response("{}")); });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledExactlyOnceWith("/login"));
    const protectedSurface = view.container.querySelector(".protected-surface");
    expect(protectedSurface).not.toBeVisible(); expect(protectedSurface).toHaveAttribute("inert");
    expect(screen.queryByLabelText("Editor draft")).not.toBeInTheDocument();
    expect(screen.getByTestId("retained-session-draft")).toHaveTextContent("cleared");
    expect(discarded).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("");
    expect(pushMock).not.toHaveBeenCalled(); expect(refreshMock).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 401, error: "Invalid password" },
    { status: 429, error: "Too many attempts" },
  ])("retains editor and confirmation values when revoke-all fails: $status", async ({ status, error }) => {
    const fetchMock = protectedFetch(async () => new Response(JSON.stringify({ error }), { status }));
    const discarded = vi.fn();
    const view = protectedManager(discarded);
    await screen.findByText(/This device/);
    fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong-attempt" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); });
    expect(screen.getByRole("alert")).toHaveTextContent(error);
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Retained editor work");
    expect(screen.getByLabelText("Current password")).toHaveValue("wrong-attempt");
    expect(view.container.querySelector(".protected-surface")).toBeVisible();
    expect(screen.getByTestId("retained-session-draft")).toHaveTextContent("retained");
    expect(discarded).not.toHaveBeenCalled(); expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
