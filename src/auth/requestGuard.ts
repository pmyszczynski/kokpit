/**
 * Require an explicit same-origin browser request for state-changing auth
 * endpoints. The custom header prevents a cross-origin form submission, while
 * Sec-Fetch-Site rejects cross-site fetches where the browser supplies Fetch
 * Metadata. Some non-browser clients omit that header, so they remain allowed
 * only when they opt in with the custom header.
 */
export function isTrustedMutation(req: Request): boolean {
  if (req.headers.get("x-kokpit-request") !== "1") return false;

  const fetchSite = req.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";
}
