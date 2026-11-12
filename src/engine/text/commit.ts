const REPEAT_CHARS = 24;

/**
 * Appends one streamed chunk. A provider that resends the whole string so far
 * (a snapshot) replaces the buffer; a provider that sends only the new suffix
 * is concatenated. A snapshot that is not a prefix of what we already have is
 * still concatenated, so `<H` followed by `>` stays `<H>`.
 */
export function appendDelta(before: string, delta: string): string {
  if (delta.length === 0) return before;
  if (before.length === 0 || delta.startsWith(before)) return delta;
  return before + delta;
}

/**
 * Cuts a second pass off a finished piece. Models sometimes translate a line,
 * then keep going and translate that output again. The first copy is the one
 * we show.
 *
 * The source string is not a signal: a translation is allowed to contain it
 * (a name, a quotation, or a prefix the caller added). Only the opening of the
 * translation repeating later counts, and a short string is left alone.
 */
export function dropRetranslation(_source: string, output: string): string {
  if (output.length < REPEAT_CHARS * 2) return output;
  const head = output.slice(0, REPEAT_CHARS);
  const again = output.indexOf(head, REPEAT_CHARS);
  if (again >= REPEAT_CHARS) return output.slice(0, again).trimEnd();
  return output;
}

/**
 * The committed text of one piece. The engine's `final` is the authority,
 * except when it is a strict prefix of the streamed text: that is the tail a
 * token limit or a short buffer dropped, and the stream still has those
 * characters. A stream that is longer only because it repeated the translation
 * is cut first, so the repeat does not win over `final`.
 */
export function commitPiece(source: string, streamed: string, finalText: string): string {
  const cutStream = dropRetranslation(source, streamed).trim();
  const cutFinal = dropRetranslation(source, finalText).trim();
  if (cutFinal.length > 0 && cutStream.startsWith(cutFinal) && cutStream.length > cutFinal.length) {
    return cutStream;
  }
  return cutFinal.length > 0 ? cutFinal : cutStream;
}

/** Spacing-insensitive key for "is this the translation we already painted?" */
export function comparableText(value: string): string {
  return value
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();
}
