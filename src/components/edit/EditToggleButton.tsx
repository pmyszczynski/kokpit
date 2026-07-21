"use client";

// Pencil toggle in the navbar. Shown only on the dashboard route (Navbar itself
// has no route awareness) and only for viewers allowed to edit. Clicking
// toggles edit mode; Mod+E does the same globally (see EditModeProvider).
import { usePathname } from "next/navigation";
import { useEditMode } from "./EditModeProvider";

export default function EditToggleButton() {
  const pathname = usePathname();
  const { active, toggle } = useEditMode();

  // Dashboard route only. Edit mode edits the dashboard; other protected pages
  // (e.g. /settings) keep the pencil hidden.
  if (pathname !== "/") return null;

  return (
    <button
      type="button"
      className={`edit-toggle${active ? " edit-toggle--active" : ""}`}
      onClick={toggle}
      aria-pressed={active}
      aria-label={active ? "Exit edit mode" : "Edit dashboard"}
      title={active ? "Exit edit mode (⌘E)" : "Edit dashboard (⌘E)"}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M11.5 2.5l2 2L5 13l-2.5.5L3 11l8.5-8.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
