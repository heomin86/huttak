import { inferLanguage } from '../../src/dom/detect';
import {
  HOME_LANGUAGE,
  PARTNER_LANGUAGE,
  canonicalLanguage,
  type LanguageCode,
} from '../../src/shared/languages';

export interface SelectionDirection {
  /** Null when the sample is not a script the model should be told about. */
  source: LanguageCode | null;
  /** Korean unless the selection is already Korean, which flips to English. */
  target: typeof HOME_LANGUAGE | typeof PARTNER_LANGUAGE;
}

function hasLatinLetter(text: string): boolean {
  return /[A-Za-z]/u.test(text);
}

/**
 * The pair the extension is built around, applied to a selection that has no page.
 * Korean goes to English. Latin text goes to Korean as English. Any other detected
 * script also goes to Korean, and the model is told that source when it is one of
 * PLaMo's languages. Text with no letters keeps the Korean target and no source,
 * which is how typed input leaves the language for the model to see.
 */
export function selectionDirection(text: string): SelectionDirection {
  const inferred = inferLanguage(text);
  if (inferred === HOME_LANGUAGE) {
    return { source: HOME_LANGUAGE, target: PARTNER_LANGUAGE };
  }

  const target = HOME_LANGUAGE;
  if (inferred) {
    return { source: canonicalLanguage(inferred), target };
  }
  if (hasLatinLetter(text)) return { source: PARTNER_LANGUAGE, target };
  return { source: null, target };
}
