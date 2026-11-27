/**
 * PLaMo token 813 is the section sign. The model sometimes emits it as a language
 * tag, `§ko§`, glued onto the translation. Nothing in the release build writes that
 * tag; it only has to be removed before the reader sees the text.
 *
 * The code is the same shape as a PFML3 language tag (`en`, `ja`, `ko`, `zh-hans`).
 * A section sign that is not wrapped around a code stays, so "See § 3" is kept.
 */
export function stripLanguageMarkers(value: string): string {
  return value.replace(/§[a-z]{2,3}(?:-[a-z]{4})?§/g, '');
}
