import { supabase, demoMode } from './supabase';
import type { ImageRow } from './database';
import { safeExternalUrl } from './model';

let extendedImages = true;
let artworkRequest: Promise<Record<string, string>> | undefined;
const missingSchema = (code: string | undefined) => ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code ?? '');
export async function readFrontImages(ids: string[], client = supabase, availableOnly = true): Promise<ImageRow[]> {
  if (!ids.length) return [];
  const rows: ImageRow[] = [];
  for (let from = 0; ; from += 1000) {
    const read = (extended: boolean) => {
      let query = client.from('card_images').select(extended ? 'id,card_id,storage_path,external_url,width,height,role,display_order,image_status' : 'id,card_id,storage_path,role,display_order,image_status').in('card_id', ids).eq('role', 'front');
      if (availableOnly) query = query.eq('image_status', 'available');
      return query.order('display_order').order('id').range(from, from + 999);
    };
    const usedExtended = extendedImages;
    let result = await read(usedExtended);
    if (result.error && usedExtended && missingSchema(result.error.code)) { extendedImages = false; result = await read(false); }
    if (result.error) throw new Error(result.error.message);
    const batch = result.data as unknown as ImageRow[]; rows.push(...batch);
    if (batch.length < 1000) return availableOnly ? rows : rows.sort((a, b) => Number(b.image_status === 'available') - Number(a.image_status === 'available') || (a.display_order ?? 0) - (b.display_order ?? 0) || a.id.localeCompare(b.id));
  }
}
export function cardImageSource(image: Pick<ImageRow, 'storage_path' | 'external_url'>, width?: number) {
  const external = safeExternalUrl(image.external_url ?? '');
  if (external) return external;
  if (!image.storage_path) return '';
  return supabase.storage.from('card-images').getPublicUrl(image.storage_path, width ? { transform: { width, quality: 72, resize: 'contain' } } : undefined).data.publicUrl;
}
export function loadGameArtwork(refresh = false): Promise<Record<string, string>> {
  if (demoMode) return Promise.resolve({});
  if (refresh) artworkRequest = undefined;
  return artworkRequest ??= (async () => {
    const artwork: Record<string, string> = {};
    for (let from = 0; ; from += 1000) {
      const result = await supabase.from('game_artwork').select('id,storage_path,external_url').order('id').range(from, from + 999);
      // Keep existing icons available before the optional admin migration is installed.
      if (result.error) { if (missingSchema(result.error.code) || result.error.code === '42501') return {}; throw new Error(result.error.message); }
      const rows = result.data ?? [];
      for (const row of rows) { const src = cardImageSource(row); if (src) artwork[row.id] = src; }
      if (rows.length < 1000) return artwork;
    }
  })().catch(cause => { artworkRequest = undefined; throw cause; });
}
export function clearArtworkCache() { artworkRequest = undefined; extendedImages = true; }
