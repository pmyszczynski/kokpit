"use client";

// Swaps the dashboard between the server-rendered view (`children`, an RSC
// <ServiceGrid/>) and the client-draft edit render (EditableServiceGrid). In
// view mode it renders `children` verbatim, so the fast server read path and
// existing snapshots are byte-for-byte unchanged; edit mode is purely additive.
import { useEditMode } from "./EditModeProvider";
import EditableServiceGrid from "./EditableServiceGrid";

export default function DashboardSurface({
  children,
}: {
  children: React.ReactNode;
}) {
  const { active, draft } = useEditMode();

  if (active && draft) {
    return <EditableServiceGrid config={draft} />;
  }
  return <>{children}</>;
}
