import type { Metadata } from "next";
import "./globals.css";
import { getConfig } from "@/config";
import { getConfigPath } from "@/config/loader";
import { resolveAppearance } from "@/config/theme";

export const metadata: Metadata = {
  title: "kokpit",
  description: "Your self-hosted personal dashboard",
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

  const { theme, customCss } = resolveAppearance(config!);

  return (
    <html lang="en" data-theme={theme}>
      <body>
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
