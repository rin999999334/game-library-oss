export type ExternalLinkIcon = 'x' | 'blog' | 'board' | 'external';

export function externalLinkIcon(kind: string, label: string, url: string, gameLink: boolean): ExternalLinkIcon {
  const address = new URL(url), host = address.hostname.toLowerCase();
  const belongsTo = (domain: string) => host === domain || host.endsWith('.' + domain);
  if (belongsTo('x.com') || belongsTo('twitter.com')) return 'x';
  if (/掲示板|bbs|board/i.test(kind + ' ' + label) || /\/(bbs|board)(\/|$)/i.test(address.pathname)) return 'board';
  if (/ブログ|blog/i.test(kind + ' ' + label) || /blog|tumblr|hatena/i.test(host) || belongsTo('note.com')) return 'blog';
  if (gameLink && kind === '公式サイト') return 'blog';
  return 'external';
}
