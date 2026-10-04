import * as Y from "yjs";
import { generateKeyBetween } from "fractional-indexing";
import type { NoteBlock, NoteContent } from "./model";
import { validateBoardView, validateBlockSource, validateLinkedContentLimits } from "./linked-content";

export const LOCAL_ORIGIN = Symbol("local-editor");
export const REMOTE_ORIGIN = Symbol("remote-server");
export const MAX_STATE_BYTES = 350000;
export const MAX_UPDATE_BYTES = 64000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = new Set([
  "paragraph",
  "heading",
  "bullet",
  "ordered",
  "quote",
  "todo",
  "code",
  "divider",
  "markdown",
  "board",
  "synced",
]);

export function toBase64(value: Uint8Array): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(value).toString("base64");
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid base64 collaboration payload.");
  if (value.length > Math.ceil(MAX_STATE_BYTES / 3) * 4)
    throw new Error("Collaboration payload exceeds capacity.");
  if (typeof Buffer !== "undefined")
    return new Uint8Array(Buffer.from(value, "base64"));
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function encodeDocument(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc);
  if (update.byteLength > MAX_STATE_BYTES)
    throw new Error(
      "Document collaboration capacity reached; export your work.",
    );
  return toBase64(update);
}

export function decodeDocument(state: string, options: { gc?: boolean } = {}): Y.Doc {
  const doc = new Y.Doc(options);
  try {
    Y.applyUpdate(doc, fromBase64(state), REMOTE_ORIGIN);
    // Materialize the expected root types before checking decoded schema.
    doc.getMap("blocks");
    doc.getMap("tombstones");
    validateDocument(doc);
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

// Partition the interval by all UUID bits. Equal insertion bounds with distinct
// UUIDs therefore produce disjoint intervals, rather than a rank collision.
function rankBetween(
  left: string | null,
  right: string | null,
  id: string,
): string {
  for (const hex of id.replaceAll("-", "")) {
    const nibble = parseInt(hex, 16);
    for (let bit = 3; bit >= 0; bit--) {
      const middle = generateKeyBetween(left, right);
      if ((nibble >> bit) & 1) left = middle;
      else right = middle;
    }
  }
  const rank = generateKeyBetween(left, right);
  if (rank.length > 1024)
    throw new Error("Block ordering capacity reached; export your work.");
  return rank;
}

function blockFormat(
  block: NoteBlock,
): Pick<NoteBlock, "type" | "level" | "checked" | "boardView" | "source"> {
  return {
    type: block.type,
    ...(block.level !== undefined ? { level: block.level } : {}),
    ...(block.checked !== undefined ? { checked: block.checked } : {}),
    ...(block.boardView !== undefined ? { boardView: block.boardView } : {}),
    ...(block.source !== undefined ? { source: block.source } : {}),
  };
}

function makeBlock(block: NoteBlock, rank: string): Y.Map<unknown> {
  const value = new Y.Map<unknown>();
  const meta = new Y.Map<unknown>();
  meta.set("format", blockFormat(block));
  meta.set("rank", rank);
  value.set("meta", meta);
  const text = new Y.Text();
  text.insert(0, block.text);
  value.set("text", text);
  return value;
}

export function initializeDocument(content: NoteContent): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  doc.getMap("tombstones");
  let rank: string | null = null;
  doc.transact(() => {
    for (const block of content.blocks) {
      const id = block.id ?? crypto.randomUUID();
      if (!UUID.test(id) || blocks.has(id))
        throw new Error("Invalid or duplicate block identity.");
      rank = rankBetween(rank, null, id);
      blocks.set(id, makeBlock(block, rank));
    }
  }, LOCAL_ORIGIN);
  validateDocument(doc);
  return doc;
}

export function readContent(doc: Y.Doc): NoteContent {
  const deleted = doc.getMap("tombstones");
  const blocks = [...doc.getMap<Y.Map<unknown>>("blocks")].filter(
    ([id]) => !deleted.has(id),
  );
  blocks.sort(([idA, a], [idB, b]) => {
    const rankA = (a.get("meta") as Y.Map<unknown>).get("rank") as string;
    const rankB = (b.get("meta") as Y.Map<unknown>).get("rank") as string;
    return rankA < rankB
      ? -1
      : rankA > rankB
        ? 1
        : idA < idB
          ? -1
          : idA > idB
            ? 1
            : 0;
  });
  return {
    blocks: blocks.map(([id, value]) => {
      const meta = value.get("meta") as Y.Map<unknown>;
      const block: NoteBlock = {
        id,
        ...(meta.get("format") as Pick<
          NoteBlock,
          "type" | "level" | "checked" | "boardView" | "source"
        >),
        text: (value.get("text") as Y.Text).toString(),
      };
      return block;
    }),
  };
}

// Preserve a longest common subsequence: only explicitly moved/new blocks get
// positions. Unrelated text edits never rewrite ordering metadata.
function stationaryIds(before: string[], next: string[]): Set<string> {
  const table = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(next.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      table[i][j] =
        before[i] === next[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const result = new Set<string>();
  let i = 0,
    j = 0;
  while (i < before.length && j < next.length) {
    if (before[i] === next[j]) {
      result.add(before[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return result;
}

export function applyEditorContent(
  doc: Y.Doc,
  before: NoteContent,
  next: NoteContent,
): void {
  // Yjs transactions are batching boundaries, not rollbacks. Validate a dry run
  // before touching the live document so any schema/capacity failure is atomic.
  // Retain deleted strings during dry-run validation: the live UndoManager may
  // keep them, so GC here must not underestimate the actual persisted size.
  const candidate = decodeDocument(encodeDocument(doc), { gc: false });
  try {
    const vector = Y.encodeStateVector(candidate);
    applyEditorIntent(candidate, before, next);
    validateDocument(candidate, doc);
    const update = Y.encodeStateAsUpdate(candidate, vector);
    if (update.byteLength > MAX_UPDATE_BYTES)
      throw new Error(
        "This change exceeds synchronization capacity; add smaller batches of blocks.",
      );
    Y.applyUpdate(doc, update, LOCAL_ORIGIN);
  } finally {
    candidate.destroy();
  }
}

function applyEditorIntent(
  doc: Y.Doc,
  before: NoteContent,
  next: NoteContent,
): void {
  if (next.blocks.length > 1000) throw new Error("Too many blocks.");
  // IDs assigned here are immediately reflected in the caller's optimistic draft.
  for (const block of next.blocks) block.id ??= crypto.randomUUID();
  const nextIds = next.blocks.map((block) => block.id!);
  if (
    new Set(nextIds).size !== nextIds.length ||
    nextIds.some((id) => !UUID.test(id))
  )
    throw new Error("Invalid or duplicate block identity.");
  const old = new Map(before.blocks.map((block) => [block.id, block]));
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  const deleted = doc.getMap("tombstones");
  for (const block of next.blocks) {
    if (deleted.has(block.id!)) continue;
    const existing = blocks.get(block.id!);
    const previous = old.get(block.id!);
    if (existing && !previous)
      throw new Error("An existing block cannot be recreated.");
    if (
      existing &&
      previous &&
      previous.text !== block.text &&
      (existing.get("text") as Y.Text).toString() !== previous.text
    )
      throw new Error("Editor baseline changed; reconcile before editing.");
    if (block.text.length > 20000)
      throw new Error("Block text exceeds capacity.");
  }
  if (next.blocks.reduce((sum, block) => sum + block.text.length, 0) > 100000)
    throw new Error("Document content capacity reached.");
  const stationary = stationaryIds(
    before.blocks
      .map((block) => block.id!)
      .filter((id) => nextIds.includes(id)),
    nextIds,
  );
  // Calculate all ranks before touching shared state so ordering exhaustion is atomic.
  const ranks = new Map<string, string>();
  let left: string | null = null;
  for (let index = 0; index < next.blocks.length; index++) {
    const id = nextIds[index];
    if (deleted.has(id)) continue;
    if (stationary.has(id) && blocks.has(id))
      left = (blocks.get(id)!.get("meta") as Y.Map<unknown>).get(
        "rank",
      ) as string;
    else {
      const rightId = nextIds
        .slice(index + 1)
        .find(
          (candidate) =>
            stationary.has(candidate) &&
            blocks.has(candidate) &&
            !deleted.has(candidate),
        );
      const right = rightId
        ? ((blocks.get(rightId)!.get("meta") as Y.Map<unknown>).get(
            "rank",
          ) as string)
        : null;
      // A concurrent move may invalidate stale interval bounds. Preserve the
      // intent after the left anchor instead of generating an invalid key.
      left = rankBetween(
        left,
        right !== null && left !== null && right <= left ? null : right,
        id,
      );
      ranks.set(id, left);
    }
  }
  doc.transact(() => {
    for (const block of before.blocks)
      if (block.id && !nextIds.includes(block.id)) deleted.set(block.id, true);
    for (const block of next.blocks) {
      const id = block.id!;
      if (deleted.has(id)) continue;
      const existing = blocks.get(id);
      if (!existing) {
        blocks.set(id, makeBlock(block, ranks.get(id)!));
        continue;
      }
      const previous = old.get(id);
      if (!previous) throw new Error("An existing block cannot be recreated.");
      const meta = existing.get("meta") as Y.Map<unknown>;
      if (
        JSON.stringify(blockFormat(previous)) !== JSON.stringify(blockFormat(block))
      )
        meta.set("format", blockFormat(block));
      if (ranks.has(id)) meta.set("rank", ranks.get(id)!);
      if (previous.text !== block.text) {
        const text = existing.get("text") as Y.Text;
        // The editor must reconcile remote content before delivering a local
        // action: offsets below are based on that exact visible text baseline.
        if (text.toString() !== previous.text)
          throw new Error("Editor baseline changed; reconcile before editing.");
        let start = 0;
        while (
          start < previous.text.length &&
          start < block.text.length &&
          previous.text[start] === block.text[start]
        )
          start++;
        // Y.Text offsets use UTF-16, but splitting a surrogate pair corrupts it.
        if (start > 0 && /[\uD800-\uDBFF]/.test(previous.text[start - 1]))
          start--;
        let suffix = 0;
        while (
          suffix < previous.text.length - start &&
          suffix < block.text.length - start &&
          previous.text[previous.text.length - 1 - suffix] ===
            block.text[block.text.length - 1 - suffix]
        )
          suffix++;
        if (
          suffix > 0 &&
          /[\uDC00-\uDFFF]/.test(previous.text[previous.text.length - suffix])
        )
          suffix--;
        const remove = previous.text.length - start - suffix;
        if (remove) text.delete(start, remove);
        const insert = block.text.slice(start, block.text.length - suffix);
        if (insert) text.insert(start, insert);
      }
    }
  }, LOCAL_ORIGIN);
}

export function getTextTypes(doc: Y.Doc): Y.Text[] {
  const deleted = doc.getMap("tombstones");
  return [...doc.getMap<Y.Map<unknown>>("blocks")]
    .filter(([id]) => !deleted.has(id))
    .map(([, block]) => block.get("text") as Y.Text);
}

function identity(type: {
  _item: { id: { client: number; clock: number } } | null;
}): string {
  const item = type._item;
  return item ? `${item.id.client}:${item.id.clock}` : "root";
}

export function validateDocument(doc: Y.Doc, previous?: Y.Doc): void {
  if (doc.store.pendingStructs || doc.store.pendingDs)
    throw new Error(
      "Missing collaboration dependencies; synchronize and retry.",
    );
  if (
    [...doc.share.keys()].some(
      (key) => key !== "blocks" && key !== "tombstones",
    )
  )
    throw new Error("Unknown collaboration root.");
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  const tombstones = doc.getMap("tombstones");
  if (blocks._start || tombstones._start)
    throw new Error("Invalid collaboration root encoding.");
  if (blocks.size > 5000 || tombstones.size > 5000)
    throw new Error("Document block history capacity reached.");
  for (const [id, value] of tombstones)
    if (!UUID.test(id) || value !== true || !blocks.has(id))
      throw new Error("Invalid deletion tombstone.");
  for (const [id, block] of blocks) {
    if (
      !UUID.test(id) ||
      !(block instanceof Y.Map) ||
      block.size !== 2 ||
      !block.has("meta") ||
      !block.has("text")
    )
      throw new Error("Invalid collaborative block.");
    const meta = block.get("meta");
    const text = block.get("text");
    if (
      !(meta instanceof Y.Map) ||
      !(text instanceof Y.Text) ||
      [...meta.keys()].some((key) => !["format", "rank"].includes(key))
    )
      throw new Error("Invalid collaborative block fields.");
    if (block._start || meta._start)
      throw new Error("Invalid collaborative map encoding.");
    const format = meta.get("format");
    if (
      !format ||
      typeof format !== "object" ||
      Array.isArray(format) ||
      Object.keys(format).some(
        (key) => !["type", "level", "checked", "boardView", "source"].includes(key),
      )
    )
      throw new Error("Invalid block format.");
    if (
      !TYPES.has(format.type) ||
      typeof meta.get("rank") !== "string" ||
      meta.get("rank").length > 1024
    )
      throw new Error("Invalid collaborative block metadata.");
    generateKeyBetween(meta.get("rank"), null); // Maintained key validator.
    if (
      text
        .toDelta()
        .some(
          (part: { insert?: unknown; attributes?: unknown }) =>
            typeof part.insert !== "string" || part.attributes !== undefined,
        )
    )
      throw new Error("Only plain collaborative text is supported.");
    if (
      format.level !== undefined &&
      (format.type !== "heading" ||
        !Number.isInteger(format.level) ||
        format.level < 1 ||
        format.level > 6)
    )
      throw new Error("Invalid heading level.");
    if (
      format.checked !== undefined &&
      (format.type !== "todo" || typeof format.checked !== "boolean")
    )
      throw new Error("Invalid checklist state.");
    if (format.boardView !== undefined) {
      if (format.type !== "board") throw new Error("Only board blocks have view settings.");
      validateBoardView(format.boardView);
    }
    if (format.source !== undefined) {
      if (format.type !== "synced") throw new Error("Only synced blocks have sources.");
      validateBlockSource(format.source);
    }
    if (format.type === "synced" && !format.source) throw new Error("A synced block requires a source.");
    if (
      text.length > 20000 ||
      (["board", "divider", "synced"].includes(format.type) && text.length)
    )
      throw new Error("Invalid block text length.");
  }
  const content = readContent(doc);
  validateLinkedContentLimits(content);
  if (
    content.blocks.length > 1000 ||
    content.blocks.reduce((sum, block) => sum + block.text.length, 0) > 100000
  )
    throw new Error("Document content capacity reached.");
  if (previous) {
    for (const [id, previousBlock] of previous.getMap<Y.Map<unknown>>(
      "blocks",
    )) {
      const block = blocks.get(id);
      if (
        !block ||
        identity(block) !== identity(previousBlock) ||
        identity(block.get("meta") as Y.Map<unknown>) !==
          identity(previousBlock.get("meta") as Y.Map<unknown>) ||
        identity(block.get("text") as Y.Text) !==
          identity(previousBlock.get("text") as Y.Text)
      )
        throw new Error("Immutable block identity changed.");
    }
    for (const id of previous.getMap("tombstones").keys())
      if (tombstones.get(id) !== true)
        throw new Error("Deleted blocks cannot reappear.");
  }
  encodeDocument(doc);
}
