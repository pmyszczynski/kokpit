import { ConfigUnavailableError, getConfigSnapshot } from "@/config/server";
import { configRevision } from "@/config/revision";
import SettingsPanel from "@/components/SettingsPanel";
import { toClientSafeSettings } from "@/widgets/configSecrets";

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  // Derive both props from this one unredacted snapshot. The revision is a
  // server-only HMAC and must describe the same config that was redacted for
  // the client form, otherwise a first save could reject a fresh draft.
  const snapshot = getConfigSnapshot();
  if (snapshot.state === "dirty" || !snapshot.config || !snapshot.source) {
    throw new ConfigUnavailableError();
  }

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>
      <SettingsPanel
        config={toClientSafeSettings(snapshot.config)}
        initialRevision={configRevision(snapshot.source)}
      />
    </div>
  );
}
