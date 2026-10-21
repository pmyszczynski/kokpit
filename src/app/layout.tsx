import type { Metadata } from "next";
import "./globals.css";
import { getConfigSnapshot, getPublishedConfigSnapshot } from "@/config/server";
import { isRequestAuthenticated } from "@/auth/apiAuth";
import { resolveAppearance } from "@/config/theme";

export const metadata: Metadata = {
  title: "kokpit",
  description: "Your self-hosted personal dashboard",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      {
        url: "/brand/kokpit/png/kokpit-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/brand/kokpit/png/kokpit-apple-touch-icon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Keep children mounted on invalid/cold configuration so the protected
  // surface can show neutral recovery and retry. Diagnostics belong on the
  // server; unauthenticated layouts must not expose YAML contents or paths.
  let appearance = { theme: "dark", customCss: undefined, bgStyle: {} } as ReturnType<typeof resolveAppearance>;
  try {
    const snapshot = getConfigSnapshot();
    if ((snapshot.state === "ready" || snapshot.state === "migration-required") && snapshot.config && snapshot.source
      && await isRequestAuthenticated(snapshot.config)) {
      const current = getPublishedConfigSnapshot();
      if (current.state === snapshot.state && current.source === snapshot.source && current.config === snapshot.config) {
        appearance = resolveAppearance(snapshot.config);
      }
    }
  } catch { /* The protected layout owns the generic recovery surface. */ }
  const { theme, customCss, bgStyle } = appearance;

  return (
    <html lang="en" data-theme={theme}>
      <body style={bgStyle as React.CSSProperties}>
        <style id="kokpit-custom-css" dangerouslySetInnerHTML={{
          __html: customCss ? `@layer user-custom { ${customCss} }` : "",
        }} />
        {children}
      </body>
    </html>
  );
}
