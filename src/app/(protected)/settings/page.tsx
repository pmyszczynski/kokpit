import { getConfig } from "@/config/server";
import SettingsPanel from "@/components/SettingsPanel";
import { toClientSafeSettings } from "@/widgets/configSecrets";

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const config = toClientSafeSettings(getConfig());

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>
      <SettingsPanel config={config} />
    </div>
  );
}
