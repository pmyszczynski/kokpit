import { getConfig } from "@/config";
import SettingsPanel from "@/components/SettingsPanel";

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const config = getConfig();

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>
      <SettingsPanel config={config} />
    </div>
  );
}
