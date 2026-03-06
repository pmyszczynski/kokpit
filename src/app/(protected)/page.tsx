import { getConfig } from "@/config";

export default function Home() {
  const { layout } = getConfig();

  return (
    <div
      className="dashboard-grid"
      style={
        {
          "--layout-columns": layout.columns,
        } as React.CSSProperties
      }
    >
      {/* Service tiles and widgets — added in next Phase 1 task */}
    </div>
  );
}
