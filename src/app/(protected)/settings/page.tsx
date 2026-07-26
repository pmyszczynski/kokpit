import { getConfig } from "@/config";
import SettingsPanel from "@/components/SettingsPanel";
import { redactWidgetSecrets } from "@/widgets/configSecrets";

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const config = redactWidgetSecrets(getConfig());

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>
      <SettingsPanel config={config} />
    </div>
  );
}
