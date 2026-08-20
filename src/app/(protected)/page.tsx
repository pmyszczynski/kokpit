import ServiceGrid from "@/components/ServiceGrid";
import DashboardSurface from "@/components/edit/DashboardSurface";

export const dynamic = 'force-dynamic';

export default async function Home() {
  return (
    <div
      className="dashboard-grid"
    >
      <DashboardSurface>
        <ServiceGrid />
      </DashboardSurface>
    </div>
  );
}
