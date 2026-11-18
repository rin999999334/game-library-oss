const TEAM_NAME_LIMIT = 30;
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
  : undefined;

export function displayTeamName(name: string): string {
  const characters: string[] = [];
  // Inspect at most 31 graphemes; the string iterator fallback preserves code points.
  for (const part of segmenter ? segmenter.segment(name) : name) {
    if (characters.length === TEAM_NAME_LIMIT) {
      return characters.slice(0, TEAM_NAME_LIMIT - 1).join('') + '…';
    }
    characters.push(typeof part === 'string' ? part : part.segment);
  }
  return name;
}
