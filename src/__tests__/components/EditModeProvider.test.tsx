import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import {
  editModeReducer,
  initialEditModeState,
  changedKeys,
  EditModeProvider,
  useEditMode,
  type EditModeState,
} from "@/components/edit/EditModeProvider";
import { KokpitConfigSchema, type KokpitConfig } from "@/config/schema";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function cfg(overrides: Record<string, unknown> = {}): KokpitConfig {
  return KokpitConfigSchema.parse({
    schema_version: 1,
    services: [{ name: "Plex", url: "https://plex.local" }],
    ...overrides,
  });
}

const active: EditModeState = {
  active: true,
  draft: cfg(),
  baseline: cfg(),
  baseRevision: "rev-1",
  status: "idle",
  error: null,
  conflict: false,
};

describe("editModeReducer", () => {
  it("ENTER_SUCCESS activates with draft, baseline and revision", () => {
    const config = cfg();
    const next = editModeReducer(initialEditModeState, {
      type: "ENTER_SUCCESS",
      config,
      revision: "rev-1",
    });
    expect(next.active).toBe(true);
    expect(next.draft).toBe(config);
    expect(next.baseline).toBe(config);
    expect(next.baseRevision).toBe("rev-1");
    expect(next.conflict).toBe(false);
  });

  it("DISCARD resets to the initial view-mode state", () => {
    expect(editModeReducer(active, { type: "DISCARD" })).toEqual(
      initialEditModeState
    );
  });

  it("SET_DRAFT replaces the draft only while active", () => {
    const draft = cfg({ services: [] });
    expect(
      editModeReducer(active, { type: "SET_DRAFT", draft }).draft
    ).toBe(draft);
    // Ignored in view mode.
    expect(
      editModeReducer(initialEditModeState, { type: "SET_DRAFT", draft }).draft
    ).toBeNull();
  });

  it("SAVE_SUCCESS exits edit mode and drops the draft", () => {
    const next = editModeReducer(active, {
      type: "SAVE_SUCCESS",
      revision: "rev-2",
    });
    expect(next.active).toBe(false);
    expect(next.draft).toBeNull();
    expect(next.status).toBe("saved");
    expect(next.conflict).toBe(false);
  });

  it("SAVE_ERROR keeps the draft and stays active", () => {
    const next = editModeReducer(active, {
      type: "SAVE_ERROR",
      error: "boom",
    });
    expect(next.active).toBe(true);
    expect(next.draft).not.toBeNull();
    expect(next.status).toBe("error");
    expect(next.error).toBe("boom");
  });

  it("CONFLICT flags a conflict but preserves the draft", () => {
    const next = editModeReducer(active, {
      type: "CONFLICT",
      revision: "rev-server",
      error: "changed on disk",
    });
    expect(next.conflict).toBe(true);
    expect(next.active).toBe(true);
    expect(next.draft).not.toBeNull();
    expect(next.baseRevision).toBe("rev-server");
  });

  it("RELOAD_SUCCESS refreshes the draft and clears the conflict, staying active", () => {
    const conflicted: EditModeState = { ...active, conflict: true, status: "error" };
    const config = cfg({ services: [] });
    const next = editModeReducer(conflicted, {
      type: "RELOAD_SUCCESS",
      config,
      revision: "rev-3",
    });
    expect(next.active).toBe(true);
    expect(next.conflict).toBe(false);
    expect(next.draft).toBe(config);
    expect(next.baseRevision).toBe("rev-3");
  });
});

describe("changedKeys", () => {
  it("is empty when draft equals baseline", () => {
    expect(changedKeys(cfg(), cfg())).toEqual([]);
  });

  it("lists the changed top-level key", () => {
    expect(changedKeys(cfg({ services: [] }), cfg())).toEqual(["services"]);
  });

  it("is empty for null draft/baseline", () => {
    expect(changedKeys(null, cfg())).toEqual([]);
  });
});

// ---- Hook integration (async flows through fetch) ----

function fakeResponse(
  body: unknown,
  { status = 200, revision }: { status?: number; revision?: string } = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-config-revision" ? revision ?? null : null,
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function Harness() {
  const em = useEditMode();
  return (
    <div>
      <span data-testid="active">{String(em.active)}</span>
      <span data-testid="conflict">{String(em.conflict)}</span>
      <span data-testid="dirty">{String(em.dirty)}</span>
      <span data-testid="services">{em.draft?.services.length ?? "none"}</span>
      <button onClick={() => void em.enter()}>enter</button>
      <button onClick={() => em.setServices([])}>clear-services</button>
      <button onClick={() => void em.save()}>save</button>
      <button onClick={() => void em.reload()}>reload</button>
    </div>
  );
}

describe("EditModeProvider (hook flows)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup() {
    render(
      <EditModeProvider canEdit>
        <Harness />
      </EditModeProvider>
    );
  }

  it("enter fetches the config and revision into the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeResponse(cfg(), { revision: "rev-1" }))
    );
    await setup();
    await act(async () => {
      fireEvent.click(screen.getByText("enter"));
    });
    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(screen.getByTestId("services").textContent).toBe("1");
  });

  it("save with a stale revision surfaces a conflict and keeps the draft", async () => {
    const fetchMock = vi
      .fn()
      // enter
      .mockResolvedValueOnce(fakeResponse(cfg(), { revision: "rev-1" }))
      // save → 409
      .mockResolvedValueOnce(
        fakeResponse(
          { error: "changed", code: "revision_mismatch" },
          { status: 409, revision: "rev-server" }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    await setup();
    await act(async () => {
      fireEvent.click(screen.getByText("enter"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("clear-services"));
    });
    expect(screen.getByTestId("dirty").textContent).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByText("save"));
    });
    expect(screen.getByTestId("conflict").textContent).toBe("true");
    expect(screen.getByTestId("active").textContent).toBe("true");
    // Reload button appears in the edit bar's conflict notice.
    expect(screen.getByText("Reload")).toBeInTheDocument();
  });

  it("save success exits edit mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(cfg(), { revision: "rev-1" }))
      .mockResolvedValueOnce(fakeResponse(cfg({ services: [] }), { revision: "rev-2" }));
    vi.stubGlobal("fetch", fetchMock);
    await setup();
    await act(async () => {
      fireEvent.click(screen.getByText("enter"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("clear-services"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("save"));
    });
    expect(screen.getByTestId("active").textContent).toBe("false");
  });

  it("reload re-fetches the draft and clears the conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(cfg(), { revision: "rev-1" }))
      .mockResolvedValueOnce(
        fakeResponse({ code: "revision_mismatch" }, { status: 409, revision: "rev-server" })
      )
      .mockResolvedValueOnce(fakeResponse(cfg({ services: [] }), { revision: "rev-server" }));
    vi.stubGlobal("fetch", fetchMock);
    await setup();
    await act(async () => {
      fireEvent.click(screen.getByText("enter"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("clear-services"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("save"));
    });
    expect(screen.getByTestId("conflict").textContent).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByText("reload"));
    });
    expect(screen.getByTestId("conflict").textContent).toBe("false");
    expect(screen.getByTestId("services").textContent).toBe("0");
  });
});
