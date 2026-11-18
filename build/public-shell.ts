type Output = { type: string; isEntry?: boolean; facadeModuleId?: string | null; imports?: string[]; dynamicImports?: string[]; source?: string | Uint8Array; viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } };
// Follow only the public application's dependency graph. Admin assets must not
// become part of every mobile user's offline installation.
export function publicShellFiles(bundle: Record<string, Output>, publicEntry: string): string[] {
  const selected = new Set<string>(['index.html']);
  function visit(name: string) {
    if (selected.has(name)) return;
    const item = bundle[name]; if (!item) return;
    selected.add(name);
    if (item.type === 'chunk') {
      [...(item.imports ?? []), ...(item.dynamicImports ?? []), ...(item.viteMetadata?.importedCss ?? []), ...(item.viteMetadata?.importedAssets ?? [])].forEach(visit);
    }
  }
  for (const [name, item] of Object.entries(bundle)) if (item.isEntry && item.facadeModuleId === publicEntry) visit(name);
  const html = bundle['index.html'];
  const source = typeof html?.source === 'string' ? html.source : html?.source ? new TextDecoder().decode(html.source) : '';
  for (const match of source.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)) visit(match[1].slice(1));
  return [...selected].sort();
}
