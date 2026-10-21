import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuardedLink from "@/components/unsaved/GuardedLink";
import { UnsavedChangesProvider, useUnsavedSource } from "@/components/unsaved/UnsavedChangesProvider";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), native: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: ({ onNavigate, children, ...props }: {
  onNavigate?: (event: { preventDefault: () => void }) => void; children: React.ReactNode;
  href: string; target?: string; download?: boolean;
}) => <a {...props} onClick={(event) => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || props.target === "_blank" || props.download) { navigation.native(); return; }
  let prevented = false;
  onNavigate?.({ preventDefault: () => { prevented = true; } });
  if (!prevented) navigation.native();
}}>{children}</a> }));

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
});

function DashboardDraft({ href }: { href: string }) {
  const [value, setValue] = useState("original");
  useUnsavedSource("dashboard", {
    label: "Dashboard layout", dirty: value !== "original", survivesNavigation: true,
    scope: "dashboard", version: value, discard: () => setValue("original"),
  });
  return <><input aria-label="Dashboard draft" value={value} onChange={(event) => setValue(event.target.value)} />
    <GuardedLink href={href}>Destination</GuardedLink></>;
}

describe("guarded protected-layout exits", () => {
  it.each(["/reset-password", "/login", "/settings/unknown"])("warns before %s destroys a retained dashboard", async (href) => {
    render(<UnsavedChangesProvider><DashboardDraft href={href} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Dashboard draft"), { target: { value: "kept work" } });
    fireEvent.click(screen.getByRole("link", { name: "Destination" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByLabelText("Dashboard draft")).toHaveValue("kept work");
    fireEvent.click(screen.getByRole("link", { name: "Destination" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(href, { scroll: undefined });
    expect(screen.getByLabelText("Dashboard draft")).toHaveValue("original");
  });

  it.each(["/", "/settings", "/settings/?tab=appearance#editor"])("keeps retained dashboard work during protected navigation to %s", async (href) => {
    render(<UnsavedChangesProvider><DashboardDraft href={href} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Dashboard draft"), { target: { value: "kept work" } });
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Destination" })); });
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(href, { scroll: undefined });
    expect(screen.getByLabelText("Dashboard draft")).toHaveValue("kept work");
  });
});
