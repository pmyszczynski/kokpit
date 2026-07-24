import type { Metadata } from "next";
import "./globals.css";
import { getConfig } from "@/config";
import { getConfigPath } from "@/config/loader";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let config: ReturnType<typeof getConfig> | null = null;
  let configError: string | null = null;

  try {
    config = getConfig();
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  if (configError !== null) {
    return (
      <html lang="en">
        <body>
          <div className="config-error">
            <div className="config-error__box">
              <p className="config-error__icon">⚠</p>
              <h1 className="config-error__title">Configuration Error</h1>
              <p className="config-error__subtitle">
                <code>{getConfigPath()}</code> could not be loaded.
              </p>
              <pre className="config-error__details">{configError}</pre>
            </div>
          </div>
        </body>
      </html>
    );
  }

  const { theme, customCss, bgStyle } = resolveAppearance(config!);

  return (
    <html lang="en" data-theme={theme}>
      <body style={bgStyle as React.CSSProperties}>
        {customCss && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@layer user-custom { ${customCss} }`,
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
