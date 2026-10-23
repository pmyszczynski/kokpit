import type { WidgetSetupGuide } from "@/widgets";

export const actualBudgetSetupGuide: WidgetSetupGuide = {
  title: "Connect Actual Budget",
  summary: "Connect through actual-http-api for Summary, Categories, Accounts and Schedules.",
  requirement: "Requires an Actual server and the community jhonderson/actual-http-api bridge. The bridge key can also authorize budget changes; keep it private and use HTTPS or a trusted private network.",
  steps: [
    {
      title: "Prepare the HTTP bridge",
      description: "Deploy jhonderson/actual-http-api for your Actual release. Set ACTUAL_SERVER_URL to the Actual server and ACTUAL_SERVER_PASSWORD to its login password. Keep NODE_ENV=production and a persistent /data volume. The bridge normally listens on port 5007.",
    },
    {
      title: "Set or reuse the bridge API key",
      description: "For an existing bridge, reuse API_KEY or the secret file referenced by API_KEY_PATH. For a new bridge, run openssl rand -hex 32 and set the result as API_KEY. Apply the deployment; with the example Compose service, run docker compose up -d actual-http-api.",
    },
    {
      title: "Copy your budget’s Sync ID",
      description: "Open the synced budget in Actual, then Settings → Show advanced settings → Sync ID. Copy Sync ID, rather than the local Budget ID. If the budget uses end-to-end encryption, have its existing encryption password ready too.",
    },
    {
      title: "Enter the bridge connection",
      description: "Use http://actual-http-api:5007 or the final bridge root/prefix reachable from Kokpit. Enter the bridge API Key and Budget Sync ID; add Encryption Password only for an encrypted budget. Choose currency, formatting, privacy and the available widget options. The optional service URL opens Actual’s WebUI separately.",
    },
    {
      title: "Test the connection and save",
      description: "Use Test connection when enabled, wait for Connection OK, then save. If testing is unavailable, save and check the dashboard. All four widgets can share the same bridge and budget; each refreshes every five minutes by default.",
    },
  ],
  troubleshooting: [
    {
      title: "What must the bridge deployment contain?",
      description: "Follow the linked bridge README for its Docker image and deployment. Configure ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD (or its _PATH secret file), API_KEY (or API_KEY_PATH), NODE_ENV=production and persistent /data storage. Use an image compatible with your Actual release and the configured port, normally 5007. Ensure the bridge can reach Actual and Kokpit can reach the bridge; Docker service names resolve only across shared networks. Recreate/apply the bridge service after changing environment settings. Swagger documentation is at the bridge’s /api-docs/ address, but that is not Kokpit’s URL.",
    },
    {
      title: "Which secret goes where?",
      description: "The Actual server login password belongs in the bridge’s ACTUAL_SERVER_PASSWORD, never Kokpit’s API Key field. Kokpit uses the bridge’s existing API_KEY value or the contents of API_KEY_PATH; a direct value takes precedence when both are configured. There is no Actual WebUI API-key button for this integration. Generate a random key only for a new deployment or deliberate rotation, then update every bridge client. The budget encryption password is a separate existing secret, needed only for end-to-end-encrypted budgets. The bridge downloads a local budget cache; protect its data volume as well as these credentials.",
    },
    {
      title: "Wrong or missing Sync ID, or a sync reset",
      description: "Open the intended budget and copy Settings → Show advanced settings → Sync ID. A local Budget ID or an account/category ID will not work. The budget must be uploaded and syncing to the configured Actual server. Resetting sync, including some restore/encryption operations, creates a new Sync ID: copy it again and re-enter Kokpit’s saved secrets for the new scope. Do not reset sync just to find the ID. For a forgotten encryption password, follow Actual’s recovery documentation for your available local copy rather than changing encryption during widget setup.",
    },
    {
      title: "403 Forbidden or a bridge/server error",
      description: "Check the bridge’s API_KEY against Kokpit and ensure a proxy preserves x-api-key and budget-encryption-password headers. If the deployment uses ALLOWED_BUDGET_SYNC_IDS, it must include this Sync ID. Keep NODE_ENV=production so API-key authentication stays enforced. For download/decryption/sync errors, check the bridge’s Actual URL/login password, the budget’s encryption password and compatible Actual/API versions. Inspect bridge logs without sharing secrets. Kokpit reads these endpoints; its key is not a read-only permission scope.",
    },
    {
      title: "Actual opens in my browser but Kokpit cannot connect",
      description: "The optional service URL opens Actual’s WebUI, normally port 5006. The integration URL must reach the HTTP bridge, normally port 5007, from Kokpit’s container. localhost refers to Kokpit itself. Keep the real proxy mount; do not add v1/budgets, /api-docs or other endpoint paths. Omit embedded credentials, queries and fragments. Kokpit appends v1/budgets and the Sync ID. GETs follow at most five same-origin redirects; a different scheme, host or port is blocked, so use the final address. Proxy SSO pages are not the bridge’s JSON API.",
    },
    {
      title: "When are saved secrets retained?",
      description: "The API key and encryption password are retained while both the normalized bridge URL and exact Budget Sync ID stay unchanged. Equivalent root URLs with or without a trailing slash keep them; fragments are ignored in the comparison. A normalized scheme, host, port, path or query change, or a different Sync ID, requires re-entering the applicable secrets even when their upstream values have not changed. Update Kokpit after rotating the bridge key or changing the budget encryption password.",
    },
    {
      title: "Amounts, privacy or dates look wrong",
      description: "Choose the budget’s three-letter currency code; Kokpit defaults to USD and does not detect the budget’s currency or convert amounts. Locale changes number formatting; leave it blank for automatic formatting or enter a tag such as en-GB. Privacy mode defaults on and blurs amounts until tile hover/focus; the values remain accessible, so this is visual privacy rather than access control. Summary/Categories use Timezone for the current month; Schedules uses it for today/overdue. Accounts has no timezone control. Blank or invalid zones use the Kokpit server’s timezone, normally UTC in Docker.",
    },
    {
      title: "Missing rows, totals or updates",
      description: "Check the selected widget’s option and footprint help: Categories filters/sorts before its limit; Accounts filters also affect its total; Schedules keeps overdue items and counts its due-soon footer before its display limit. Summary can show — for Net Worth when its optional accounts request fails. Schedule payee lookup can fall back to the schedule name. Sync new data in Actual first; Kokpit does not initiate bank sync. Default refresh is five minutes for every widget, with the shared five-second minimum for overrides.",
    },
  ],
  documentationUrl: "https://github.com/jhonderson/actual-http-api",
};
