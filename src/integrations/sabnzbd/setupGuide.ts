import type { WidgetSetupGuide } from "@/widgets";

export const sabnzbdSetupGuide: WidgetSetupGuide = {
  title: "Connect SABnzbd",
  summary: "Monitor download speed, queue size and download status.",
  requirement: "SABnzbd must be reachable from Kokpit. Keep the API Key private; changing it also affects other connected apps.",
  steps: [
    {
      title: "Open the API Key settings",
      description: "Open SABnzbd’s web interface. Go to Config → General and find API Key under Security.",
    },
    {
      title: "Copy the full API Key",
      description: "Click the API Key field to select its text, then copy and paste it here. The separate NZB Key only adds jobs and cannot read this widget’s queue data.",
    },
    {
      title: "Enter SABnzbd’s base address",
      description: "Use an address reachable from Kokpit, usually port 8080. Keep any reverse-proxy prefix, such as https://example.com/sabnzbd/. Do not add /api or a query string; Kokpit builds the queue request.",
    },
    {
      title: "Test, then save",
      description: "If Test connection is enabled, click it and wait for Connection OK, then save. Otherwise, save the form and check the widget on your dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "API Key Required / API Key Incorrect",
      description: "Copy the value from API Key in SABnzbd’s General → Security settings. NZB Key cannot read the queue. If the API Key was changed, paste its new value here; include no apikey= or Bearer prefix.",
    },
    {
      title: "Refused connection with hostname",
      description: "In SABnzbd’s Config → Special, add the expected hostname to host_whitelist, or use the server’s IP address. Whitelist entries are hostnames without a scheme, port or path; separate multiple entries with commas.",
    },
    {
      title: "Access denied from outside the local network",
      description: "Prefer a private network connection. If external access is needed, use HTTPS and restrict access to trusted clients. In Config → General → Security → External internet access, API (no config) permits queue/history access and adding or removing jobs. Kokpit only reads the queue; this permission level also allows changes.",
    },
    {
      title: "Cannot reach SABnzbd",
      description: "Check the Web server host/port in Config → General, container networking and the firewall. localhost inside Docker points to Kokpit’s container. HTTPS needs a certificate trusted by Kokpit.",
    },
    {
      title: "404 or an HTML response",
      description: "Use the base address, retaining any reverse-proxy prefix, without /api or its query parameters. Check that the proxy forwards API requests; a separate browser login session is not sent by Kokpit.",
    },
  ],
  documentationUrl: "https://sabnzbd.org/wiki/configuration/5.1/general",
};
