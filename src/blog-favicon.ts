export function blogFaviconKey(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = ''; url.search = '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

export type BlogFavicons = Record<string, { src: string }>;
async function readFavicons(path: string): Promise<BlogFavicons> {
  return fetch(path, { signal: AbortSignal.timeout(8000) }).then(async response => {
    if (!response.ok) throw new Error('Blog icon list unavailable');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid blog icon list');
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, { src: string }] => {
      const item = entry[1];
      return Boolean(item && typeof item === 'object' && 'src' in item && typeof item.src === 'string' && /^\/blog-favicons\/[a-f0-9]{24}\.png$/.test(item.src));
    }));
  });
}
let request: Promise<BlogFavicons> | undefined;
export function loadBlogFavicons(): Promise<BlogFavicons> {
  return request ??= readFavicons('/blog-favicons.json').catch(() => { request = undefined; return {}; });
}
let gameRequest: Promise<BlogFavicons> | undefined;
export function loadGameFavicons(): Promise<BlogFavicons> {
  return gameRequest ??= readFavicons('/game-blog-favicons.json').catch(() => { gameRequest = undefined; return {}; });
}
