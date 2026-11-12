import {
  parsePlaceholders,
  stripPlaceholderTokens,
  visibleTranslation,
  type PlaceholderPart,
} from './placeholders';
import {
  allSlots,
  placeholderIds,
  type InlineFrame,
  type SegmentModel,
  type TextSlot,
} from './segment';

const LINE_TAG = 'sakutto-line';
/**
 * Older builds painted a "quick translation" badge beside every Chrome draft. The badge
 * is gone, but a block translated by an older build can still hold one, so the cleanup
 * paths keep stripping it.
 */
const LEGACY_NOTE_TAG = 'sakutto-note';

interface Frame {
  element: Element;
  gaps: TextSlot[][];
  children: InlineFrame[];
}

export function applyTranslation(model: SegmentModel, translation: string, created: Text[]): void {
  discardCreated(created);
  removeInsertedBreaks(model.block);
  const parts = parsePlaceholders(translation, placeholderIds(model));
  const root: Frame = { element: model.block, gaps: model.gaps, children: model.children };
  if (!parts || !applyFrame(root, parts, created)) {
    restoreChildOrder(ordered(model));
    discardCreated(created);
    writeFlat(model, stripPlaceholderTokens(translation), created);
  }
}

export function restoreSegment(model: SegmentModel, created: Text[]): void {
  restoreStructure(model, created);
  removeTranslationUi(model.block);
  model.block.removeAttribute('data-sakutto-pending');
  model.block.removeAttribute('data-sakutto-id');
  model.block.removeAttribute('data-sakutto-engine');
}

export function restoreStructure(model: SegmentModel, created: Text[]): void {
  discardCreated(created);
  removeInsertedBreaks(model.block);
  removeTranslationUi(model.block);
  restoreChildOrder(ordered(model));
  for (const slot of allSlots(model)) slot.node.nodeValue = slot.original;
}

export function paintPlain(model: SegmentModel, translation: string, created: Text[]): void {
  discardCreated(created);
  removeInsertedBreaks(model.block);
  writeFlat(model, visibleTranslation(translation), created);
}

/**
 * Adds the second, translated line under the original. The line holds the translation and
 * nothing else: no badge and no engine caption, whatever translated it.
 */
export function showBilingual(model: SegmentModel, translation: string, created: Text[]): void {
  restoreStructure(model, created);

  const line = ensureChild(model.block, LINE_TAG);
  line.replaceChildren();
  line.setAttribute('translate', 'no');
  line.append(model.block.ownerDocument.createTextNode(visibleTranslation(translation)));
}

export function removeTranslationUi(block: Element): void {
  removeLine(block);
}

function discardCreated(created: Text[]): void {
  for (const node of created) node.remove();
  created.length = 0;
}

const INSERTED_BREAK = 'data-sakutto-br';

function removeInsertedBreaks(root: ParentNode): void {
  for (const node of [...root.querySelectorAll(`[${INSERTED_BREAK}]`)]) node.remove();
}

function preservesNewlines(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return false;
  const view = element.ownerDocument.defaultView;
  const computed = view ? view.getComputedStyle(element).whiteSpace : '';
  const declared = /\bwhite-space\s*:\s*([^;]+)/iu.exec(element.getAttribute('style') ?? '');
  const value = (computed || declared?.[1] || '').trim();
  return (
    value === 'pre' || value === 'pre-wrap' || value === 'pre-line' || value === 'break-spaces'
  );
}

interface OrderedFrame {
  element: Element;
  children: readonly InlineFrame[];
  order: readonly ChildNode[];
}

function ordered(model: SegmentModel): OrderedFrame {
  return { element: model.block, children: model.children, order: model.order };
}

function restoreChildOrder(frame: OrderedFrame): void {
  for (const child of frame.children) restoreChildOrder(child);
  const parent = frame.element;
  for (const node of frame.order) {
    if (node.parentNode === parent) parent.appendChild(node);
  }
}

function applyFrame(frame: Frame, parts: readonly PlaceholderPart[], created: Text[]): boolean {
  const gapTexts: string[] = [];
  const tags: { id: string; children: PlaceholderPart[] }[] = [];
  let buffer = '';

  for (const part of parts) {
    if (part.type === 'text') {
      buffer += part.value;
      continue;
    }
    gapTexts.push(buffer);
    buffer = '';
    tags.push({ id: part.id, children: part.children });
  }
  gapTexts.push(buffer);

  if (tags.length !== frame.children.length) return false;

  const byId = new Map(frame.children.map((child) => [child.id, child]));
  for (const tag of tags) {
    const child = byId.get(tag.id);
    if (!child) return false;
    if (!applyFrame(child, tag.children, created)) return false;
  }

  const sameOrder = tags.every((tag, index) => tag.id === frame.children[index]?.id);
  if (!sameOrder && hasUnrelatedChildren(frame)) {
    writeGapsInPlace(frame, gapTexts, created);
    return true;
  }

  if (!sameOrder) {
    reorder(frame, tags, gapTexts, byId, created);
    return true;
  }

  writeGapsInPlace(frame, gapTexts, created);
  return true;
}

function writeGapsInPlace(frame: Frame, gapTexts: readonly string[], created: Text[]): void {
  for (let index = 0; index < frame.gaps.length; index += 1) {
    const slots = frame.gaps[index] ?? [];
    const value = gapTexts[index] ?? '';
    if (slots.length === 0) {
      if (value.length === 0) continue;
      const anchor = frame.children[index]?.element ?? null;
      insertFresh(frame.element, anchor, value, created);
      continue;
    }
    writeSlots(slots, value, created);
  }
}

/**
 * Moves the original inline elements into the translated order. Nodes are not cloned, and
 * restore puts the previous child order back before rewriting node values.
 */
function reorder(
  frame: Frame,
  tags: readonly { id: string }[],
  gapTexts: readonly string[],
  byId: ReadonlyMap<string, InlineFrame>,
  created: Text[],
): void {
  const pool = frame.gaps.flat();
  let cursor = 0;

  const takeText = (value: string): Text => {
    const slot = pool[cursor];
    cursor += 1;
    if (slot) {
      slot.node.nodeValue = value;
      return slot.node;
    }
    const node = frame.element.ownerDocument.createTextNode(value);
    created.push(node);
    return node;
  };

  const desired: Node[] = [];
  const pushText = (value: string): void => {
    if (!value.includes('\n') || preservesNewlines(frame.element)) {
      desired.push(takeText(value));
      return;
    }
    const lines = value.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) {
        const br = frame.element.ownerDocument.createElement('br');
        br.setAttribute(INSERTED_BREAK, '');
        desired.push(br);
      }
      desired.push(takeText(line));
    });
  };

  for (let index = 0; index < tags.length; index += 1) {
    pushText(gapTexts[index] ?? '');
    const inline = byId.get(tags[index]?.id ?? '');
    if (inline) desired.push(inline.element);
  }
  pushText(gapTexts[tags.length] ?? '');

  while (cursor < pool.length) {
    const extra = pool[cursor];
    cursor += 1;
    if (!extra) continue;
    extra.node.nodeValue = '';
    desired.push(extra.node);
  }

  for (const node of desired) frame.element.appendChild(node);
}

function hasUnrelatedChildren(frame: Frame): boolean {
  const managed = new Set<Node>();
  for (const slot of frame.gaps.flat()) managed.add(slot.node);
  for (const child of frame.children) managed.add(child.element);

  for (const node of frame.element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim().length === 0) continue;
    if (!managed.has(node) && !isTranslationChrome(node)) return true;
  }

  return false;
}

function isTranslationChrome(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.tagName === 'SAKUTTO-LINE' || node.tagName === LEGACY_NOTE_TAG.toUpperCase())
  );
}

function writeFlat(model: SegmentModel, value: string, created: Text[]): void {
  const slots = allSlots(model);
  if (slots.length === 0) {
    writeInto(model.block, model.block.firstChild, value, created);
    return;
  }

  writeSlots(slots, value, created);
}

function writeSlots(slots: readonly TextSlot[], value: string, created: Text[]): void {
  const first = slots[0];
  if (!first) return;
  const parent = first.node.parentNode;
  if (!parent) return;

  const groups = value.includes('\n') ? groupsSplitByBreaks(slots) : null;
  const lines = value.split(/\n+/u);
  if (groups && groups.length === lines.length) {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index] ?? [];
      const head = group[0];
      if (!head) continue;
      head.node.nodeValue = lines[index] ?? '';
      for (const slot of group.slice(1)) slot.node.nodeValue = '';
    }
    return;
  }

  if (!value.includes('\n') || preservesNewlines(first.node)) {
    first.node.nodeValue = value;
    for (const slot of slots.slice(1)) slot.node.nodeValue = '';
    return;
  }

  const pieces = value.split('\n');
  first.node.nodeValue = pieces[0] ?? '';
  let after: Node = first.node;
  for (let index = 1; index < pieces.length; index += 1) {
    const br = first.node.ownerDocument.createElement('br');
    br.setAttribute(INSERTED_BREAK, '');
    const text = first.node.ownerDocument.createTextNode(pieces[index] ?? '');
    const next = after.nextSibling;
    parent.insertBefore(br, next);
    parent.insertBefore(text, next);
    created.push(text);
    after = text;
  }
  for (const slot of slots.slice(1)) slot.node.nodeValue = '';
}

/**
 * Text slots the page already separates with its own `<br>` elements. One group
 * per run of breaks, so a blank line (`<br><br>`) stays one separator and the
 * translation of each side lands in the slot that was already there.
 */
function groupsSplitByBreaks(slots: readonly TextSlot[]): TextSlot[][] | null {
  const parent = slots[0]?.node.parentNode;
  if (!parent || !slots.every((slot) => slot.node.parentNode === parent)) return null;
  const byNode = new Map(slots.map((slot) => [slot.node, slot]));
  const groups: TextSlot[][] = [];
  let current: TextSlot[] = [];
  for (const child of parent.childNodes) {
    const slot = byNode.get(child as Text);
    if (slot) {
      current.push(slot);
      continue;
    }
    if (
      child instanceof Element &&
      child.tagName === 'BR' &&
      !child.hasAttribute(INSERTED_BREAK) &&
      current.length > 0
    ) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.length > 1 ? groups : null;
}

function insertFresh(parent: Node, anchor: Node | null, value: string, created: Text[]): void {
  const doc = parent.ownerDocument;
  if (!doc) return;
  const pieces = value.includes('\n') && !preservesNewlines(parent) ? value.split('\n') : [value];
  pieces.forEach((piece, index) => {
    if (index > 0) {
      const br = doc.createElement('br');
      br.setAttribute(INSERTED_BREAK, '');
      parent.insertBefore(br, anchor);
    }
    if (piece.length === 0 && pieces.length === 1) return;
    const node = doc.createTextNode(piece);
    parent.insertBefore(node, anchor);
    created.push(node);
  });
}

function writeInto(parent: Node, anchor: Node | null, value: string, created: Text[]): void {
  const doc = parent.ownerDocument;
  if (!doc) return;
  if (!value.includes('\n') || preservesNewlines(parent)) {
    const existing = created[0];
    if (existing && existing.parentNode === parent) {
      existing.nodeValue = value;
      return;
    }
    if (value.length === 0) return;
    const node = doc.createTextNode(value);
    parent.insertBefore(node, anchor);
    created.push(node);
    return;
  }

  const pieces = value.split('\n');
  pieces.forEach((piece, index) => {
    if (index > 0) {
      const br = doc.createElement('br');
      br.setAttribute(INSERTED_BREAK, '');
      parent.insertBefore(br, anchor);
    }
    const node = doc.createTextNode(piece);
    parent.insertBefore(node, anchor);
    created.push(node);
  });
}

function ensureChild(block: Element, tag: string): HTMLElement {
  for (const child of block.children) {
    if (child.tagName === tag.toUpperCase() && child.parentElement === block)
      return child as HTMLElement;
  }
  const element = block.ownerDocument.createElement(tag);
  block.append(element);
  return element;
}

function removeLine(block: Element): void {
  for (const child of [...block.children]) {
    if (child.tagName === 'SAKUTTO-LINE') child.remove();
  }
  removeLegacyNote(block);
}

/**
 * Strips the badge an older build painted beside Chrome drafts. Nothing creates one any
 * more; this only clears a block that an earlier version already painted.
 */
function removeLegacyNote(block: Element): void {
  for (const child of [...block.children]) {
    if (child.tagName === LEGACY_NOTE_TAG.toUpperCase()) child.remove();
  }
}

/**
 * Removes every leftover badge under a root. The per-block cleanup only reaches blocks
 * this session paints, and a block an older build already translated into the target
 * language is never repainted, so a stale 「簡易訳」 would otherwise stay on screen.
 */
export function stripLegacyNotes(root: ParentNode): void {
  for (const note of [...root.querySelectorAll(LEGACY_NOTE_TAG)]) note.remove();
}
