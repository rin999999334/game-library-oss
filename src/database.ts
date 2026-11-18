// Browser-read contract: columns checked against DATABASE_DESIGN.md and anonymous REST reads.
// Keep write types unavailable in this public app; full DDL remains owned by Supabase.
export type EventRow = { id: string; name: string; fiscal_year: number | null; start_date: string | null; end_date: string | null; schedule_note: string | null; status: string | null; theme: string | null };
export type CardRow = { id: string; event_id: string; name: string; source_card_id: string | null; source_type: string | null; card_type: string | null; rank: string | null; effect_text: string | null; flavor_text: string | null; publication_status: string; created_at: string };
export type ImageRow = { id: string; card_id: string; storage_path: string | null; external_url?: string | null; width?: number | null; height?: number | null; role: string; display_order: number; image_status: string };
export type GameArtworkRow = { id: string; storage_path: string | null; external_url: string | null };
export type PersonRow = { id: string; display_name: string; code_name: string | null; joined_year: number | null };
export type ParticipationRow = { id: string; person_id: string; event_id: string; team_id: string | null; role_id: string | null; kind: string | null; name_at_event: string | null; status: string };
export type TeamRow = { id: string; event_id: string; display_name: string; rank_value: number | null; rank_note: string | null; final_score: number | null };
export type RoleRow = { id: string; label: string; kind: string };
export type LinkRow = { id: string; person_id: string | null; event_id: string | null; kind: string; label: string; url: string };
type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
export type Database = { public: {
  Tables: { events: Table<EventRow>; cards: Table<CardRow>; card_images: Table<ImageRow>; game_artwork: Table<GameArtworkRow>; people: Table<PersonRow>; participations: Table<ParticipationRow>; teams: Table<TeamRow>; roles: Table<RoleRow>; resource_links: Table<LinkRow>; person_names: Table<{person_id:string;name:string}>; dp_periods: Table<{id:string;code:string}>; dp_records: Table<{period_id:string;person_id:string;points:number}> };
  Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
} };
