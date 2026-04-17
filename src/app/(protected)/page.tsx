import { getConfig } from "@/config";
import ServiceGrid from "@/components/ServiceGrid";

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { layout } = getConfig();

  const cssVars: Record<string, string | number> = {
    "--layout-columns-desktop": layout.columns,
    "--layout-row-height-desktop": `${layout.row_height}px`,
  };
  if (layout.tablet?.columns != null)
    cssVars["--layout-columns-tablet"] = layout.tablet.columns;
  if (layout.tablet?.row_height != null)
    cssVars["--layout-row-height-tablet"] = `${layout.tablet.row_height}px`;
  if (layout.mobile?.columns != null)
    cssVars["--layout-columns-mobile"] = layout.mobile.columns;
  if (layout.mobile?.row_height != null)
    cssVars["--layout-row-height-mobile"] = `${layout.mobile.row_height}px`;

  return (
    <div
      className="dashboard-grid"
      style={cssVars as React.CSSProperties}
    >
      <ServiceGrid />
    </div>
  );
}
