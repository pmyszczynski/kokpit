import type { Metadata } from "next";
import "./globals.css";
import { getConfig } from "@/config";
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
  const config = getConfig();
  const { theme, customCss } = resolveAppearance(config);

  return (
    <html lang="en" data-theme={theme}>
      <head>
        {customCss && (
          <style>{`@layer user-custom { ${customCss} }`}</style>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
