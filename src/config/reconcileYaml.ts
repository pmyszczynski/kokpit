import { isDeepStrictEqual } from "node:util";
import {
  isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit,
  type Document, type Node, type YAMLSeq,
} from "yaml";

/** Safe public error; never includes values, comments, source text, or paths. */
export class UnsupportedYamlUpdateError extends Error {
  readonly code = "unsupported_yaml_update";

  constructor() {
    super("This YAML update cannot safely preserve aliases or comment ownership. Edit settings.yaml directly, or expand shared aliases before saving in the UI.");
    this.name = "UnsupportedYamlUpdateError";
  }
}

type Path = Array<string | number>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function primitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function uniqueIndex(values: unknown[], key: (value: unknown) => unknown): Map<unknown, number> {
  const indexes = new Map<unknown, number>();
  const repeated = new Set<unknown>();
  values.forEach((value, index) => {
    const identity = key(value);
    if (identity === undefined) return;
    if (indexes.has(identity)) repeated.add(identity);
    else indexes.set(identity, index);
  });
  repeated.forEach((identity) => indexes.delete(identity));
  return indexes;
}

function namedIdentity(value: unknown): string | undefined {
  return record(value) && typeof value.name === "string" ? value.name.trim().toLowerCase() : undefined;
}

function linkIdentity(value: unknown): string | undefined {
  return record(value) && typeof value.name === "string" && typeof value.url === "string"
    ? JSON.stringify([value.name, value.url]) : undefined;
}

/** Link edits retain ownership only when both directions identify one record. */
function bookmarkMatches(before: unknown[], after: unknown[]): Array<number | undefined> {
  const oldExact = uniqueIndex(before, linkIdentity);
  const newExact = uniqueIndex(after, linkIdentity);
  const matches = after.map((value) => {
    const identity = linkIdentity(value);
    return identity !== undefined && newExact.has(identity) ? oldExact.get(identity) : undefined;
  });
  const used = new Set(matches.filter((index) => index !== undefined));
  const remaining = after.map((value, index) => ({ value, index })).filter(({ index }) => matches[index] === undefined);
  const sharesField = (left: unknown, right: unknown) => record(left) && record(right)
    && (left.name === right.name || left.url === right.url);
  for (const { value, index } of remaining) {
    const candidates = before.map((old, oldIndex) => ({ old, oldIndex }))
      .filter(({ old, oldIndex }) => !used.has(oldIndex) && sharesField(old, value));
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    if (remaining.filter(({ value: other }) => sharesField(candidate.old, other)).length !== 1) continue;
    matches[index] = candidate.oldIndex;
    used.add(candidate.oldIndex);
  }
  return matches;
}

function sequenceMatches(path: Path, before: unknown[], after: unknown[]): Array<number | undefined> {
  let identity: ((value: unknown) => unknown) | undefined;
  if (path.length === 1 && ["services", "service_tiles"].includes(String(path[0]))) {
    identity = (value) => record(value) && typeof value.id === "string" ? value.id : undefined;
  } else if (path.length === 1 && ["groups", "bookmarks"].includes(String(path[0]))) {
    identity = namedIdentity;
  } else if (path.length === 3 && path[0] === "bookmarks" && path[2] === "links") {
    return bookmarkMatches(before, after);
  } else if (before.every(primitive) && after.every(primitive)) {
    identity = (value) => `${typeof value}:${JSON.stringify(value)}`;
  }
  if (!identity) return after.map(() => undefined);
  const oldUnique = uniqueIndex(before, identity);
  const newUnique = uniqueIndex(after, identity);
  return after.map((value) => {
    const key = identity(value);
    return newUnique.has(key) ? oldUnique.get(key) : undefined;
  });
}

/** Preserve field metadata when its value changes node type, not child comments. */
function replaceNode(document: Document, old: Node | null, value: unknown): Node {
  const replacement = document.createNode(value) as Node;
  if (old) {
    replacement.commentBefore = old.commentBefore;
    replacement.comment = old.comment;
    replacement.spaceBefore = old.spaceBefore;
    if (!isAlias(old) && !isAlias(replacement)) replacement.anchor = old.anchor;
  }
  return replacement;
}

/**
 * Update only submitted sections, retaining supported logical owners' nodes.
 * The caller must schema-validate before this function and validate its exact
 * serialized result afterwards. Unsupported graph edits fail before persistence.
 */
export function reconcileSettingsDocument(document: Document, updates: Record<string, unknown>): string {
  const original = document.toJS() as Record<string, unknown>;
  const expected = { ...original, ...updates };
  const referenced = new Set<Node>();
  visit(document, {
    Alias(_key, alias) {
      const target = alias.resolve(document);
      if (target) referenced.add(target);
    },
  });

  function rejectReferencedRemoval(node: unknown): void {
    if (!isNode(node)) return;
    visit(node, { Node(_key, child) { if (referenced.has(child)) throw new UnsupportedYamlUpdateError(); } });
  }

  function update(node: Node | null, value: unknown, path: Path): Node {
    const previous = node?.toJS(document);
    if (node && isDeepStrictEqual(previous, value)) return node;
    if (node && (isAlias(node) || referenced.has(node))) throw new UnsupportedYamlUpdateError();

    if (isMap(node) && record(value)) {
      // Complex YAML keys have no unambiguous JSON field owner.
      if (node.items.some((pair) => !isScalar(pair.key) || typeof pair.key.value !== "string")) {
        rejectReferencedRemoval(node);
        return replaceNode(document, node, value);
      }
      node.items = node.items.filter((pair) => {
        const key = String((pair.key as { value: unknown }).value);
        if (Object.hasOwn(value, key)) return true;
        rejectReferencedRemoval(pair.key);
        rejectReferencedRemoval(pair.value);
        return false;
      });
      for (const [key, child] of Object.entries(value)) {
        const pair = node.items.find((entry) => isScalar(entry.key) && entry.key.value === key);
        if (pair) pair.value = update(isNode(pair.value) ? pair.value : null, child, [...path, key]);
        else node.items.push(document.createPair(key, child));
      }
      return node;
    }
    if (isSeq(node) && Array.isArray(value)) {
      const before = previous as unknown[];
      const matches = sequenceMatches(path, before, value);
      const retained = new Set(matches.filter((index) => index !== undefined));
      node.items.forEach((item, index) => { if (!retained.has(index)) rejectReferencedRemoval(item); });
      const items = node.items;
      node.items = value.map((child, index) => {
        const oldIndex = matches[index];
        const old = oldIndex === undefined ? null : items[oldIndex];
        return update(isNode(old) ? old : null, child, [...path, index]);
      }) as YAMLSeq["items"];
      return node;
    }
    if (isScalar(node) && primitive(value)) {
      // Explicit scalar tags may force the previous type (for example !!str).
      // A changed UI value owns its type; a fresh scalar lets the schema choose
      // the representation while retaining field comments and an unshared anchor.
      if (node.tag) return replaceNode(document, node, value);
      node.value = value;
      return node;
    }
    rejectReferencedRemoval(node);
    return replaceNode(document, node, value);
  }

  if (!isMap(document.contents)) throw new UnsupportedYamlUpdateError();
  for (const [key, value] of Object.entries(updates)) {
    const pair = document.contents.items.find((entry) => isScalar(entry.key) && entry.key.value === key);
    if (pair) pair.value = update(isNode(pair.value) ? pair.value : null, value, [key]);
    else document.contents.items.push(document.createPair(key, value));
  }
  // yaml prints an item's commentBefore above its dash. If that item becomes
  // first, reparsing attaches the comment to the whole sequence instead. Keep
  // map-item comments inside the dash so subsequent saves retain their owner.
  visit(document, {
    Seq(_key, sequence) {
      for (const item of sequence.items) {
        if (!isNode(item) || !item.commentBefore) continue;
        if (isMap(item) && item.items.length && isNode(item.items[0].key)) {
          const key = item.items[0].key;
          key.commentBefore = [item.commentBefore, key.commentBefore].filter(Boolean).join("\n");
        } else {
          // Primitive options have no mapping key; inline comments have stable
          // item ownership even when a value moves to the first position.
          item.comment = [item.commentBefore, item.comment].filter(Boolean).join("\n");
          if (isSeq(item) || isMap(item)) item.flow = true;
        }
        item.commentBefore = undefined;
      }
    },
  });
  let source: string;
  try {
    source = document.toString();
    const resultingDocument = parseDocument(source);
    if (resultingDocument.errors.length || !isDeepStrictEqual(resultingDocument.toJS(), expected)) {
      throw new UnsupportedYamlUpdateError();
    }
  } catch {
    // Includes dangling/forward aliases after a valid ID-based reorder.
    throw new UnsupportedYamlUpdateError();
  }
  return source;
}
