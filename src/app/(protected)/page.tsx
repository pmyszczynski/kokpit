import { getConfig } from "@/config";
import ServiceGrid from "@/components/ServiceGrid";

export default async function Home() {
  const { layout } = getConfig();
  const columns = Number.isInteger(layout.columns) && layout.columns > 0 ? layout.columns : 4;

  return (
    <div
      className="dashboard-grid"
      style={{ "--layout-columns": columns } as React.CSSProperties}
    >
      <ServiceGrid />
    </div>
  );
}
