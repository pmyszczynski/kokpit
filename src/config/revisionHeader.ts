// Response header carrying the current config revision. Split out from
// ./revision (which imports `node:crypto`) so client code can reference the
// header name without pulling a Node builtin into the browser bundle.
export const CONFIG_REVISION_HEADER = "X-Config-Revision";
