const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const CHOSEONG_SET = new Set(CHOSEONG);

export function extractChoseong(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = Math.floor((code - 0xac00) / (21 * 28));
      result += CHOSEONG[idx];
    } else if (!/\s/.test(text[i])) {
      result += text[i].toLowerCase();
    }
  }
  return result;
}

export function isChoseongQuery(query: string): boolean {
  const compact = query.replace(/\s+/g, '');
  if (!compact) return false;
  let hasChoseong = false;
  for (let i = 0; i < compact.length; i++) {
    const ch = compact[i];
    if (CHOSEONG_SET.has(ch)) {
      hasChoseong = true;
    } else if (!/[a-zA-Z0-9]/.test(ch)) {
      return false;
    }
  }
  return hasChoseong;
}

export function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}
