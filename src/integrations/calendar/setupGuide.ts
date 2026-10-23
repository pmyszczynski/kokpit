import type { WidgetSetupGuide } from "@/widgets";

export const calendarSetupGuide: WidgetSetupGuide = {
  title: "Connect Calendar",
  summary: "CalDAV: follow steps 1–2. Public Google Calendar: follow steps 3–5. Finish with step 6.",
  requirement: "Choose CalDAV with username/password or an already anonymous collection, or a public Google calendar. Private Google/OAuth login and ordinary ICS feeds are not supported. Use HTTPS for credentials and keep passwords/keys private.",
  steps: [
    {
      title: "CalDAV — copy the collection URL",
      description: "Use the calendar collection, rather than its discovery or ICS URL. For a calendar you own in Nextcloud: Calendar → … → Edit and share calendar → Internal link → … → Copy internal link. Other providers need their actual calendar collection address.",
    },
    {
      title: "CalDAV — set credentials if required",
      description: "For an already anonymous collection, skip password creation and leave both CalDAV fields blank. For Nextcloud: avatar → Personal settings → Security → Devices & sessions. Enter Kokpit as App name → Create new app password, then copy Login and Password immediately. Reuse known Kokpit credentials when available; 2FA needs an app password.",
    },
    {
      title: "Google — prepare an intended public calendar",
      description: "On a computer, open the calendar’s Settings and sharing → Access permissions for events → Make available to public. Choose See all event details only if you intend to publish them. Under Integrate calendar, copy Calendar ID, rather than its public or iCal URL.",
    },
    {
      title: "Google — enable the API and get a key",
      description: "In Google Cloud, select or create a project. Open APIs & Services → Library → Google Calendar API → Enable. Then Credentials → Create credentials → API key → Copy. Use a dedicated Kokpit key, or reuse an existing key already configured for this Calendar API use.",
    },
    {
      title: "Google — restrict the key",
      description: "Open that key → API restrictions → Restrict key → Google Calendar API → Save. If Kokpit has fixed public egress IPs, also select Application restrictions → IP addresses and add them. Website/HTTP-referrer restrictions do not fit Kokpit’s server requests.",
    },
    {
      title: "Enter matching fields, test and save",
      description: "CalDAV: enter its collection URL and required username/password, or leave both blank for an already anonymous collection; clear Google API key. Google: enter Calendar ID and key; clear both CalDAV fields. Choose days, limit and time zone. Test when enabled, wait for Connection OK, then save; otherwise save and check the dashboard. Use Clear saved credential for unused saved secrets.",
    },
  ],
  troubleshooting: [
    {
      title: "Which URL, ID and credentials belong together?",
      description: "An HTTP(S) Calendar value selects CalDAV and Kokpit sends a read-only REPORT query. It supports Basic username/password login, or both fields blank for a collection already allowing anonymous REPORT. Do not disable provider authentication to connect. An email-like Google Calendar ID selects Google’s public API and requires Google API key, with both CalDAV fields empty. primary, embed/share URLs and public/secret iCal links are not Google IDs. Private Google calendars, OAuth, service-account JSON and ordinary ICS feeds are outside this widget’s supported connection modes.",
    },
    {
      title: "Finding the right Nextcloud collection",
      description: "Use the Internal link procedure in the CalDAV setup path for an owned calendar. A typical result is https://cloud.example.com/remote.php/dav/calendars/me/personal/. Keep the exact path and final slash. Copy public link opens a sharing page; Copy subscription link/Export gives a feed or download. A general /remote.php/dav or account URL needs discovery, which Kokpit does not perform. Incoming shared/delegated calendars can hide the Internal link control: obtain that account’s actual collection URL through the provider’s CalDAV client/discovery tools instead of guessing a path.",
    },
    {
      title: "Nextcloud app passwords or CalDAV 401/403",
      description: "Use the credential procedure in the CalDAV setup path, or reuse your known Kokpit app password. Copy the dialog’s Login and Password immediately: the password is shown once. Use Login as CalDAV username, rather than a display name. With 2FA, the normal account password is rejected by Nextcloud’s CalDAV clients. Other providers have their own app-password/login procedure. Read access to the collection is required; these credentials can have broader provider permissions even though Kokpit only reads. If changing accounts, replace the password too; usernames cannot contain a colon.",
    },
    {
      title: "Google 403/404 or private/missing event details",
      description: "Check the copied Calendar ID using the Google setup path, not an event ID or URL. Verify intentional public sharing and the desired event-detail visibility. Google Workspace administrators can restrict public sharing. The API key identifies a Cloud project and quota; it does not sign in as a Google user or make a calendar private. A key cannot grant access to a private Google calendar. Confirm Google Calendar API is enabled in the same project as the key and allow time for permission/restriction changes to take effect.",
    },
    {
      title: "Google key restrictions or quota errors",
      description: "Confirm the Calendar API restriction described in the Google setup path. For application IP restrictions, enter the public outbound address Google sees for the Kokpit server, including applicable IPv4/IPv6 or VPN/NAT egress; your browser or Docker/LAN address is usually different. Website referrers and mobile-app restrictions do not match these server-side calls. Use a dedicated key instead of narrowing a key shared with unrelated APIs. Keep the key private and update IP restrictions if egress changes. For 429/quota errors, wait for the limit to clear and consider a longer refresh interval; the default is five minutes.",
    },
    {
      title: "Calendar works in a browser but not in Kokpit",
      description: "The final CalDAV collection address must be reachable from Kokpit’s container; localhost means that container. LAN/Docker addresses are supported when reachable. Preserve real provider/proxy paths and use the final HTTPS URL with its correct trailing slash: Calendar requests never follow redirects. A proxy must allow REPORT and preserve Basic Authorization; a web login/SSO page or an ICS response is not a CalDAV XML response. Embedded URL credentials and fragments are rejected. The optional service URL opens your provider’s WebUI separately.",
    },
    {
      title: "Saved secrets and switching between providers",
      description: "Saved password/key references are retained only for an unchanged Calendar text value. Editing that value, including adding/removing a trailing slash on a CalDAV URL, requires re-entering the applicable secret; this field does not use URL-normalization equivalence. A blank saved-password input retains its old value: use Clear saved credential for a secret that the new path must leave empty, and clear unused CalDAV username too. Changing only days, limit or time zone keeps the connection. Username changes alone do not change the saved-secret scope, so enter the correct password when switching accounts. Replace Kokpit’s saved value after an upstream rotation.",
    },
    {
      title: "Days, time zones and all-day events",
      description: "Days ahead is a rolling window from the last fetch, in 24-hour periods, rather than whole dates starting at midnight. Ongoing events are included; events that already ended are not upcoming. Time zone defaults to UTC and must be a valid IANA name, such as Europe/Warsaw; invalid names are rejected. Timed events use that zone. All-day dates keep their calendar day, with an exclusive source end rendered as an inclusive last day. Floating CalDAV times use the calendar’s X-WR-TIMEZONE when present, otherwise the tile’s zone.",
    },
    {
      title: "Empty agenda, recurrence errors or fewer events",
      description: "The Event limit caps both footprints; the header counts returned/displayed events, not every event in the provider calendar. A valid empty result says No upcoming events. Detailed only adds location and description; it does not request more events. Refresh errors retain previous events with a warning. Some recurrence forms, including RDATE periods and THISANDFUTURE ranges, produce an error rather than a partial agenda. Dense/large calendars can exceed response, recurrence or time limits; reducing Days ahead can help, while Event limit alone does not shrink CalDAV’s REPORT payload. Default refresh is five minutes.",
    },
  ],
  documentationUrl: "https://github.com/pmyszczynski/kokpit#calendar",
};
