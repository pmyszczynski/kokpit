import { ConfigUnavailableError, getConfigSnapshot } from "@/config/server";
import { configRevision } from "@/config/revision";
import SettingsPanel from "@/components/SettingsPanel";
import { toClientSafeSettings } from "@/widgets/configSecrets";

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const snapshot = getConfigSnapshot();
  if (snapshot.state === "dirty" || !snapshot.config || !snapshot.source) {
    throw new ConfigUnavailableError();
  }
  const config = toClientSafeSettings(snapshot.config);
  const showSessionManager = config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>
      <SettingsPanel
        config={config}
        showSessionManager={showSessionManager}
        initialRevision={configRevision(snapshot.source)}
      />
    </div>
  );
}
