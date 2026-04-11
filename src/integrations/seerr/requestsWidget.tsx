import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchRequests, SeerrConfigSchema } from "./api";
import type { SeerrConfig, SeerrRequest } from "./api";

type EffectiveStatus = "pending" | "approved" | "available" | "declined" | "failed";

function effectiveStatus(req: SeerrRequest): EffectiveStatus {
  if (req.mediaStatus === 5) return "available";
  if (req.requestStatus === 2) return "approved";
  if (req.requestStatus === 3) return "declined";
  if (req.requestStatus === 4) return "failed";
  return "pending";
}

function formatSeasons(seasons: number[]): string {
  if (seasons.length === 0) return "";
  const sorted = [...seasons].sort((a, b) => a - b);
  if (sorted.length === 1) return ` S${String(sorted[0]).padStart(2, "0")}`;

  // Check if all seasons form a contiguous range
  const isContiguous = sorted.every((s, i) => i === 0 || s === sorted[i - 1] + 1);
  if (isContiguous) {
    const first = String(sorted[0]).padStart(2, "0");
    const last = String(sorted[sorted.length - 1]).padStart(2, "0");
    return ` S${first}-S${last}`;
  }

  return " " + sorted.map((s) => `S${String(s).padStart(2, "0")}`).join(",");
}

function displayTitle(req: SeerrRequest): string {
  const base = req.title ?? (req.mediaType === "movie" ? "(Movie)" : "(Show)");
  if (req.mediaType === "tv" && req.seasons && req.seasons.length > 0) {
    return base + formatSeasons(req.seasons);
  }
  return base;
}

function relativeTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return "unknown";
  const diff = Math.max(0, Date.now() - ms);
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

const STATUS_LABELS: Record<EffectiveStatus, string> = {
  pending: "pending",
  approved: "approved",
  available: "available",
  declined: "declined",
  failed: "failed",
};

export function SeerrRequestsWidget({
  data,
  loading,
  error,
}: WidgetProps<SeerrRequest[]>) {
  if (!data) {
    return (
      <div className="seerr-requests-widget seerr-requests-widget--empty">
        {loading && (
          <span className="seerr-requests-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="seerr-requests-widget__hint seerr-requests-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="seerr-requests-widget seerr-requests-widget--empty">
        <span className="seerr-requests-widget__hint">No requests</span>
        {error && (
          <span
            className="seerr-requests-widget__stale-error"
            role="alert"
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="seerr-requests-widget" aria-label="Seerr requests">
      <div className="seerr-requests-widget__list">
        {data.map((req) => {
          const status = effectiveStatus(req);
          const title = displayTitle(req);
          return (
            <div key={req.id} className="seerr-requests-widget__row">
              <span
                className={`seerr-requests-widget__badge seerr-requests-widget__badge--${status}`}
              >
                {STATUS_LABELS[status]}
              </span>
              <span
                className={`seerr-requests-widget__type seerr-requests-widget__type--${req.mediaType}`}
              >
                {req.mediaType}
              </span>
              <div className="seerr-requests-widget__info">
                <span
                  className="seerr-requests-widget__title"
                  title={title}
                >
                  {title}
                </span>
                <span className="seerr-requests-widget__requester">
                  {req.requestedBy}
                </span>
              </div>
              <span className="seerr-requests-widget__time">
                {relativeTime(req.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
      {error && (
        <span className="seerr-requests-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SeerrConfig, SeerrRequest[]>({
  id: "seerr-requests",
  name: "Seerr Requests",
  configSchema: SeerrConfigSchema,
  fetchData: fetchRequests,
  refreshInterval: 60_000,
  component: SeerrRequestsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:5055",
      description: "Works with Seerr, Jellyseerr, and Overseerr",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
  serviceEditorPreset: {
    defaultName: "Seerr",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@main/svg/seerr.svg",
  },
});
