import type { WidgetSetupGuide } from "@/widgets";

export const plexSetupGuide: WidgetSetupGuide = {
  title: "Connect Plex",
  summary: "Show playback activity and selected library totals from your server.",
  requirement: "Use the server owner’s account. Its token carries that account’s access; keep it private and use HTTPS or a trusted private network.",
  steps: [
    {
      title: "Open one of your library items",
      description: "In a desktop browser, sign in to Plex Web as the server owner. Choose your server’s library and open an individual movie or episode, rather than Plex’s online catalog or a collection.",
    },
    {
      title: "Find and copy X-Plex-Token",
      description: "Open the item’s … menu → Get Info, then View XML at the bottom of the Media Info window. In the new tab’s address bar, copy only the X-Plex-Token parameter value, stopping before any following &.",
    },
    {
      title: "Enter your Media Server address",
      description: "Use the server address reachable from Kokpit, normally http://plex:32400. Keep any real proxy prefix; do not append /web or an XML endpoint. app.plex.tv is the web app, not your server’s API address.",
    },
    {
      title: "Paste the token, test and save",
      description: "Paste the token value alone, then choose the footprint and display fields. Use Test connection when enabled, then save. If testing is unavailable, save and check the dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "Get Info or View XML is missing",
      description: "Use Plex Web in a desktop browser and open an individual item already scanned into your own server. The XML link is available to the server owner; a shared or managed account is not sufficient for this setup path. Expand the window and scroll the Media Info dialog to its bottom. A collection or Plex’s online catalog is not the same as a local library item.",
    },
    {
      title: "Which token, and how long does it last?",
      description: "Use the X-Plex-Token value, without the full URL, parameter name, Bearer or quotes. Do not use your password or a PLEX_CLAIM setup token. Plex describes the XML method as temporary; its newer JWT tokens expire after seven days. Kokpit does not renew the pasted token automatically. Replace it after expiry or revocation. A saved token is retained only while the server URL stays unchanged; URL edits require re-entry. Upstream requests use a token query parameter, so keep proxy logs private too.",
    },
    {
      title: "401, 403 or an expired-token error",
      description: "Check that you copied the entire value from the correct owner account and server. Playback sessions require administrator access, including the Detailed list even when only library metrics are selected. A shared user’s accessible libraries do not grant all-session access. Plex sign-out, revocation or expiry can invalidate a saved token; repeat the documented lookup rather than disabling server authentication.",
    },
    {
      title: "Plex Web works but Kokpit cannot connect",
      description: "Use the Media Server’s actual scheme, host and port, normally 32400, reachable from the Kokpit container. localhost inside Kokpit points to that container. Keep real proxy mounts and omit appended web/XML routes, queries and fragments. GET requests can follow up to five same-origin redirects; a different host, port or HTTP-to-HTTPS redirect is blocked, so enter the final address. Proxy sign-in pages are not the API response.",
    },
    {
      title: "What do the playback measurements mean?",
      description: "Streaming counts returned playback sessions, including paused sessions. Transcoding counts entries with a TranscodeSession, rather than CPU usage or only video encodes. LAN/Remote follow Plex’s lan/wan session labels; Users counts distinct nonempty user names. Bandwidth sums Plex’s reported session bitrates and displays Mbps, Gbps or Tbps; it is not a measured network-interface rate. Detailed shows returned playback state and progress, not only actively playing items.",
    },
    {
      title: "Library totals or displayed fields differ",
      description: "Movies, Shows and Episodes count matching items across accessible libraries; Music counts albums, not artists or tracks. Failed individual count requests can leave partial or zero totals. Custom Display selections override the size-default checkbox. Use Use default fields to restore defaults instead of unchecking every field. Only Detailed (3×4) has a playback list; Expanded (6×4) is a measurements grid. Refresh defaults to ten seconds and does not renew the token.",
    },
  ],
  documentationUrl: "https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/",
};
