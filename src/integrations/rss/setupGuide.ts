import type { WidgetSetupGuide } from "@/widgets";

export const rssSetupGuide: WidgetSetupGuide = {
  title: "Set up RSS / Atom",
  summary: "Read headlines from one public RSS or Atom feed. No API key, account or reusable service connection is needed.",
  requirement: "Use a publisher-provided HTTP(S) XML feed reachable from Kokpit’s server. Feed requests cannot use private/LAN/VPN addresses or URLs containing a username/password. There are no per-feed login, cookie or custom-header settings.",
  steps: [
    {
      title: "Find the publisher’s feed link",
      description: "Open the publisher’s RSS/Atom or subscription page and choose a feed. Copy the feed link’s address, not the address of that directory or a normal article. For a concrete example, NASA’s RSS Feeds page has General Interest Feeds → Recently Published Content; use https://www.nasa.gov/feed/ for that feed. The README links to the official page and format specifications.",
    },
    {
      title: "Add the tile and paste Feed URL",
      description: "Select RSS / Atom, give the tile a name and paste the copied URL into Feed URL. Keep the complete publisher URL, including any required public query parameters. Each tile reads one feed; add separate tiles for more feeds. An optional launch URL opens the tile header’s website and does not select the feed. The Name labels the tile; the list’s feed title comes from the XML.",
    },
    {
      title: "Choose the article limit and footprint",
      description: "Article limit defaults to 10 and accepts whole numbers from 1 to 50. Kokpit keeps the first entries in publisher order, without sorting by date or fetching older pages. Compact 3×3 and Wide 6×3 show headlines/dates; Detailed 6×4 adds plain-text summaries when supplied. All sizes retain the selected articles in a scrolling list. The count is the displayed result, not the publisher’s archive total.",
    },
    {
      title: "Set a suitable refresh interval",
      description: "Leave Refresh interval empty for 600,000 ms (ten minutes), or enter a publisher-appropriate interval in milliseconds. The minimum is 5,000 ms, but faster polling increases requests and does not make the publisher add articles sooner. Each open tile/viewer polls independently. Article limit changes the parsed result, not how much feed XML is downloaded.",
    },
    {
      title: "Test, save and inspect the list",
      description: "Test when enabled, then save the form and complete the normal dashboard save flow; otherwise save and inspect the tile. Test fetches the draft Feed URL before saving. Check the feed name, article count, scroll and a headline link. A valid empty feed shows No articles in this feed. Later refresh failures can retain the previous articles with a warning.",
    },
  ],
  troubleshooting: [
    {
      title: "A web page, login screen or invalid feed is returned",
      description: "Kokpit needs XML, not a publisher home page, RSS directory, JSON Feed or HTML article. It does not discover feed links automatically or run JavaScript challenges. A feed URL need not end in .xml or .rss. Verify the publisher’s actual feed response. RSS 2.0, RSS 1.0/RDF and Atom are supported, with a 2 MiB UTF-8 XML limit. Malformed XML, DTD/entity declarations or nesting beyond 40 elements are rejected. Lowering Article limit does not bypass document limits.",
    },
    {
      title: "It opens in my browser but Kokpit cannot fetch it",
      description: "The server/container must reach the feed and every redirect target through public addresses. Localhost, private networks, metadata endpoints and mixed public/private DNS answers are blocked for feeds. A browser’s login session/cookies are not copied to Kokpit, and embedded URL usernames/passwords are rejected. Check public DNS, outbound HTTP(S), proxy and trusted certificates. Feed URL is ordinary configuration, not a masked secret field; use a public publisher feed rather than a URL containing private credentials.",
    },
    {
      title: "Fewer articles, unexpected order or old content",
      description: "Article limit is a maximum, not a request for that many new articles. A publisher can supply fewer entries, older dates or its own order; RSS 1.0 uses the publisher’s sequence when present. Kokpit does not paginate, merge feeds, filter keywords or maintain unread state. Every size keeps the configured results; scroll to reach entries below the visible rows. The displayed count reflects the retained articles after the limit, not all content on the website.",
    },
    {
      title: "Missing summaries, pictures, dates or clickable headlines",
      description: "Select Detailed 6×4 for summaries; Compact/Wide show dates only. Feed text is extracted as plain text, with article titles/summaries limited to 500 characters. Publisher HTML, images and podcast media are not rendered or fetched as full articles. Missing dates show Date unavailable; valid dates display in UTC with the year. Missing titles show Untitled article. A headline without a usable HTTP(S) article link stays text; valid links open separately from the optional header launch URL.",
    },
    {
      title: "Refresh warning, publisher errors or rate limiting",
      description: "A previously loaded list can stay visible when a later fetch fails. Check the publisher’s status and current feed URL, and keep or increase the default interval if requests are limited. The configured interval controls polling; feed TTL/push notifications are not used to schedule updates. Repeated Test clicks make additional requests. A successful test proves the feed was fetched and parsed at that moment, not that it has articles, summaries or future updates.",
    },
  ],
  documentationUrl: "https://github.com/pmyszczynski/kokpit#rss--atom",
};
