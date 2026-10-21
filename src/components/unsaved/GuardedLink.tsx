"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useUnsavedChanges } from "./UnsavedChangesProvider";

/** Supported Next navigation interception; new tabs/downloads keep native behavior. */
export default function GuardedLink({ onNavigate, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const unsaved = useUnsavedChanges();
  const router = useRouter();
  return <Link {...props} onNavigate={(event) => {
    let cancelled = false;
    onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
    if (cancelled) return;
    if (!unsaved) return;
    event.preventDefault();
    const destination = new URL(props.href, window.location.href);
    const pathname = destination.pathname.replace(/\/$/, "") || "/";
    // Only these routes share the layout that owns retained dashboard drafts.
    const retainsProtectedLayout = destination.origin === window.location.origin
      && (pathname === "/" || pathname === "/settings");
    void unsaved.confirm({ navigation: retainsProtectedLayout }).then((allowed) => {
      if (!allowed) return;
      if (props.replace) router.replace(props.href, { scroll: props.scroll });
      else router.push(props.href, { scroll: props.scroll });
    });
  }} />;
}
