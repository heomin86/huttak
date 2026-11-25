import { stripLanguageMarkers } from './language-marker';

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
 *
 * Language tags are removed after that cut, including from a tail that is kept
 * because `final` is only a prefix. The comparison uses the stripped strings, so
 * a tag the cleanup already took off `final` cannot come back from the raw
 * stream, and a tag in front of the stream cannot hide the tail. A result that
 * is empty only because the tag was the whole answer returns the source. A
 * result that was already empty stays empty, so a failed request can still
 * report that it produced nothing.
 */
export function commitPiece(source: string, streamed: string, finalText: string): string {
  const rawStream = dropRetranslation(source, streamed).trim();
  const rawFinal = dropRetranslation(source, finalText).trim();
  const cutStream = stripLanguageMarkers(rawStream).trim();
  const cutFinal = stripLanguageMarkers(rawFinal).trim();
  const chosen =
    cutFinal.length > 0 && cutStream.startsWith(cutFinal) && cutStream.length > cutFinal.length
      ? cutStream
      : cutFinal.length > 0
        ? cutFinal
        : cutStream;
  if (chosen.length > 0) return chosen;
  if (rawStream.length > 0 || rawFinal.length > 0) return source;
  return '';
}

/** Spacing-insensitive key for "is this the translation we already painted?" */
export function comparableText(value: string): string {
  return value
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();
}
