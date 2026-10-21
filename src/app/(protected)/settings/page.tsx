import { redirect } from "next/navigation";
import { getAuthorizedRenderSnapshot } from "@/config/authorizedRender";
import { configRevision } from "@/config/revision";
import { ConfigurationSnapshotBoundary } from "@/components/ConfigurationSyncProvider";
import SettingsPanel from "@/components/SettingsPanel";
import { toClientSafeSettings } from "@/widgets/configSecrets";

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const access = await getAuthorizedRenderSnapshot();
  if (access.state === "denied") redirect("/login");
  if (access.state !== "allowed") {
    return <ConfigurationSnapshotBoundary revision={null}>{null}</ConfigurationSnapshotBoundary>;
  }
  const { snapshot } = access;
  const config = toClientSafeSettings(snapshot.config);
  const showSessionManager = config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";

  return (
    <ConfigurationSnapshotBoundary revision={configRevision(snapshot.source)}>
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>
      <SettingsPanel
        config={config}
        showSessionManager={showSessionManager}
        initialRevision={configRevision(snapshot.source)}
      />
    </div>
    </ConfigurationSnapshotBoundary>
  );
}
