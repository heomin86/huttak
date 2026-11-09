import {
  canonicalLanguage,
  HOME_LANGUAGE,
  isChromeOnlyLanguage,
  PARTNER_LANGUAGE,
} from '@/shared/languages';

/** Short labels that show up on many sites. Cached once so a later visit skips inference. */
const ENGLISH_UI = [
  'Sign in',
  'Log in',
  'Sign up',
  'Log out',
  'Settings',
  'Search',
  'Home',
  'Next',
  'Previous',
  'Learn more',
  'Read more',
  'Cancel',
  'Close',
  'Menu',
  'Save',
  'Download',
] as const;

const KOREAN_UI = [
  '로그인',
  '로그아웃',
  '회원가입',
  '설정',
  '검색',
  '홈',
  '다음',
  '이전',
  '더보기',
  '자세히 보기',
  '취소',
  '닫기',
  '메뉴',
  '저장',
  '다운로드',
] as const;

export interface PrewarmRequest {
  src: string;
  segments: { id: string; text: string }[];
}

export function prewarmRequest(target: string): PrewarmRequest | null {
  const language = canonicalLanguage(target);
  if (!language || isChromeOnlyLanguage(language)) return null;

  const fromKorean = language === PARTNER_LANGUAGE;
  const lines = fromKorean ? KOREAN_UI : ENGLISH_UI;
  return {
    src: fromKorean ? HOME_LANGUAGE : PARTNER_LANGUAGE,
    segments: lines.map((text, index) => ({ id: `ui-${String(index)}`, text })),
  };
}
