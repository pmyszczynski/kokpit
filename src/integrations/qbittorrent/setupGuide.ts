import type { WidgetConfigField, WidgetSetupGuide } from "@/widgets";

export const qbittorrentSetupGuide: WidgetSetupGuide = {
  title: "Connect qBittorrent",
  summary: "Use the same WebUI login for transfer stats and the torrent list.",
  requirement: "Kokpit uses a WebUI username and password. These credentials grant qBittorrent control; keep them private and use HTTPS or a trusted private network.",
  steps: [
    {
      title: "Enable and locate the WebUI",
      description: "In desktop qBittorrent, open Tools → Options → Web UI and enable Web User Interface (Remote control). Check its IP address and Port, normally 8080, are reachable from Kokpit. For a headless install, open its running WebUI.",
    },
    {
      title: "Find or set the WebUI login",
      description: "Reuse your known WebUI login. On a new headless install without a saved password (4.6.1+), read the temporary password in startup output, sign in, then set a strong password under Web UI → Authentication and save it.",
    },
    {
      title: "Enter the address and credentials",
      description: "Use the final WebUI root, normally http://qbittorrent:8080, keeping any real proxy prefix. Kokpit adds the API paths. Enter the configured WebUI username and password; a qBittorrent API key is not accepted in these fields.",
    },
    {
      title: "Test the connection and save",
      description: "Use Test connection when enabled, wait for Connection OK, then save. If testing is unavailable, save and check the dashboard. Stats and Torrents can share the same configured integration.",
    },
  ],
  troubleshooting: [
    {
      title: "Where do I get the password?",
      description: "Use the credentials under Tools → Options → Web UI → Authentication. Username is commonly admin, but use your configured value. A masked or empty password field does not reveal the stored password: reuse a known password or set a new strong one. Use Apply/OK in desktop Options or Save in the WebUI. First-start qBittorrent-nox 4.6.1+ prints a temporary password in its console; check service/container startup logs when applicable. Save a permanent password and update other clients using that login.",
    },
    {
      title: "Can I use an API key or bypass authentication?",
      description: "qBittorrent 5.2+ offers API keys, but these Kokpit widgets currently sign in through auth/login with a username/password and keep a session cookie. An API key cannot be substituted for the password. Both credential fields are required; localhost/subnet authentication bypass is not a replacement for this setup. Keep authentication enabled. The credentials are for the WebUI, not your OS, proxy or tracker account.",
    },
    {
      title: "I forgot a custom headless password",
      description: "For qBittorrent-nox 4.6.1+, follow the official recovery procedure: stop qBittorrent, back up its actual qBittorrent.conf, remove its WebUI\\Password_PBKDF2 line, then save and start it in the console. Use the generated temporary password with the configured username, set a strong WebUI password and save it. Config locations differ for services and containers. Do not edit a running client’s file; other password-based clients need the replacement too. Older versions need their version-specific recovery instructions.",
    },
    {
      title: "Login rejected, 401/403 or a temporary IP ban",
      description: "First verify the same credentials in qBittorrent’s WebUI. A login can return HTTP 200 with Fails. instead of a session; HTTP 403 can mean too many failed attempts. Correct the credentials and wait for the configured ban duration rather than repeatedly retrying. For invalid-host or proxy errors, check the WebUI’s Server domains, listening port and proxy Host/forwarded headers. Use the official proxy configuration and keep host/CSRF checks enabled.",
    },
    {
      title: "WebUI works in my browser but not in Kokpit",
      description: "Use the actual WebUI address reachable from the Kokpit container, including its configured/published port and any real proxy prefix. localhost refers to Kokpit’s own container. Omit appended API paths, credentials, queries and fragments. Login POST requests never follow redirects, even within one origin; use the final HTTPS/proxy address. Data GETs can follow up to five same-origin redirects. Proxy SSO/sign-in pages or stripped session cookies can block the API login.",
    },
    {
      title: "When is a saved password retained?",
      description: "An untouched saved password is kept while both the normalized WebUI URL and exact username stay unchanged. Equivalent root URLs with or without a trailing slash keep it; fragments are ignored in the comparison. A change to the normalized scheme, host, port, path or query, or to the username, requires re-entering the password. Blank fields cannot configure anonymous login. Update Kokpit when the upstream password changes.",
    },
    {
      title: "Totals or Active/Inactive differ from qBittorrent",
      description: "Totals are downloaded/uploaded bytes in the current qBittorrent session, not lifetime totals. Speeds use decimal KB/s or MB/s; totals use decimal MB or GB. Detailed Stats counts queued, stopped and older paused states as Inactive; every other returned state counts as Active, including stalled, checking or error states. These are state categories, not a count of torrents currently transferring bytes. Activity unavailable/— is not zero: the optional counts can fail while transfer values still work.",
    },
    {
      title: "Where are filters, limits or measurement selectors?",
      description: "Neither widget has those settings. Stats changes its fixed measurements through the footprint and refreshes every ten seconds by default. Torrents uses one 3×4 footprint, requests the unfiltered list without an item limit, keeps the returned order and scrolls all returned rows; its default refresh is fifteen seconds. The list shows each torrent’s name, rounded progress and download/upload speeds.",
    },
  ],
  documentationUrl: "https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#authentication",
};

export const qbittorrentConnectionFields: WidgetConfigField[] = [
  {
    key: "url", label: "URL", type: "url", required: true,
    placeholder: "http://qbittorrent:8080",
    description: "Final HTTP(S) WebUI root reachable from Kokpit, normally port 8080 or your configured published port. Direct IP/hostname URLs work; keep any real proxy prefix, with or without a final slash. Kokpit adds api/v2 paths. Omit credentials, query strings and fragments. The optional service URL opens the WebUI separately.",
  },
  {
    key: "username", label: "Username", type: "text", required: true, placeholder: "admin",
    description: "The configured WebUI username from Web UI → Authentication. admin is a common initial name, not an automatic Kokpit default. Use the exact value rather than an OS/proxy/tracker account. Changing it requires re-entering the saved password.",
  },
  {
    key: "password", label: "Password", type: "password", required: true,
    description: "Your current WebUI login password, rather than an API key. Reuse a known password or set and save one in qBittorrent first; a new headless install may provide a temporary password in startup output. A saved password is retained while the normalized URL and username stay unchanged; a different normalized URL or username requires re-entry. Both fields are required for this login flow.",
  },
];
