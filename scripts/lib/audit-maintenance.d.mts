export interface MeasuredImage {
  id: string;
  card_id: string;
  storage_path: string | null;
  external_url: string | null;
  checksum_sha256: string | null;
  width: number | null;
  height: number | null;
  measured_width: number;
  measured_height: number;
  error?: string | null;
}
export function imageDimensionSql(rows: MeasuredImage[], rollback?: boolean): string;
export function verifiedCardsSql(rows: {before: Record<string, unknown> & {id: string}; after: Record<string, unknown> & {id: string}}[], rollback?: boolean): string;
