import { supabase, configured, demoMode } from './supabase';
import type { CardRow, ParticipationRow, PersonRow, TeamRow } from './database';
import { cached, peek } from './cache';
import { cardImageSource, readFrontImages } from './artwork';
import { rememberCardPreview, rememberImageSize } from './card-preview';
import type { EventRow } from './database';
import { PAGE_SIZE, cardSubtitle, compareCards, orderGames, orderCardDirectory, searchClassifier, searchLiteral, personSubtitle, type Card, type CardParams, type ResultItem } from './model';

const eventColumns = 'id,name,fiscal_year,start_date,end_date,schedule_note,status,theme' as const;
const cardColumns = 'id,event_id,name,source_card_id,source_type,card_type,rank,effect_text,flavor_text,publication_status,created_at' as const;
const cardDirectoryColumns = 'id,event_id,source_card_id,name,rank,card_type' as const;
const personColumns = 'id,display_name,code_name,joined_year' as const;
const participationColumns = 'id,person_id,event_id,team_id,role_id,kind,name_at_event,status' as const;
function assertConnection() { if (!configured) throw new Error('接続設定が必要です。'); }
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error('記録が見つかりませんでした。');
  return result.data;
}
async function allPages<T>(request: (from: number, to: number) => PromiseLike<{data: T[] | null;error: {message:string} | null}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const batch = unwrap(await request(from, from + 999)); rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
async function inChunks<T>(ids: string[], request: (ids: string[]) => PromiseLike<{data:T[] | null;error:{message:string} | null}>) {
  const unique = [...new Set(ids)];
  return (await Promise.all(Array.from({length: Math.ceil(unique.length / 200)}, (_, index) => request(unique.slice(index * 200, (index + 1) * 200))).map(async request => unwrap(await request)))).flat();
}
export function loadEvents() { return cached('events', async () => {
  if (demoMode) return (await import('./demo/api')).loadEvents();
  assertConnection();
  return orderGames(await allPages((from, to) => supabase.from('events').select(eventColumns).order('id').range(from,to)));
}); }
function baseCards<Columns extends string = typeof cardColumns>(params: CardParams, columns: Columns = cardColumns as Columns, count = true) {
  let query = supabase.from('cards').select(columns, count ? { count: 'exact' } : {}).eq('publication_status', 'published');
  if (params.eventId) query = query.eq('event_id', params.eventId);
  if (params.type === 'other') query = query.or('card_type.eq.other,card_type.is.null');
  else if (params.type === 'defence' || params.type === 'defense' || params.type === 'guard') query = query.in('card_type', ['defence','defense','guard']);
  else if (params.type) query = query.eq('card_type', params.type);
  if (params.q) {
    const {q,type,rank} = searchClassifier(params.q);
    if (type) query = type === 'defence' || type === 'defense' || type === 'guard' ? query.in('card_type', ['defence', 'defense', 'guard']) : query.eq('card_type',type);
    else if (rank) query = query.in('rank',[rank,rank.toUpperCase()]);
    else if (q) {
      const eventIds=(peek<EventRow[]>('events') ?? []).filter(event=>event.name.normalize('NFKC').toLocaleLowerCase('ja').includes(q)).map(event=>event.id);
      query = query.or(`name.ilike.%${q}%,effect_text.ilike.%${q}%,flavor_text.ilike.%${q}%,source_card_id.ilike.%${q}%${eventIds.length ? ',event_id.in.('+eventIds.join(',')+')' : ''}`);
    }
    else query = query.eq('id','00000000-0000-0000-0000-000000000000');
  }
  return query;
}
function orderedCardIds(params: CardParams) {
  // Keep one small directory and one ordered ID list per filter; page changes reuse both.
  const criteria = JSON.stringify([params.eventId ?? '', params.type, params.q ?? '']);
  return cached(`ordered-card-ids:${params.sort}:${criteria}`, async () => {
    const [directory, events] = await Promise.all([
      cached(`card-directory:${criteria}`, () => allPages((from, to) => baseCards(params, cardDirectoryColumns, false).order('id').range(from, to))),
      params.sort === 'game' ? loadEvents() : Promise.resolve([]),
    ]);
    const ordered = params.sort === 'game' ? orderCardDirectory(directory, events) : [...directory].sort(compareCards);
    return ordered.map(card => card.id);
  });
}
async function withImages(rows: CardRow[], width = 360): Promise<Card[]> {
  const images = await readFrontImages(rows.map(row=>row.id));
  const urls = new Map<string,{imageUrl:string;originalImageUrl:string}>();
  for (const image of images) if (!urls.has(image.card_id)) {
    const originalImageUrl = cardImageSource(image);
    if (originalImageUrl) {
      rememberImageSize(originalImageUrl, image.width ?? 0, image.height ?? 0);
      urls.set(image.card_id, { imageUrl: cardImageSource(image, width), originalImageUrl });
    }
  }
  return rows.map(row => ({...row,...(urls.get(row.id) ?? {imageUrl:'',originalImageUrl:''})}));
}
export type CardPage = { items: Card[]; total: number };
export function loadCardPage(params: CardParams, page: number): Promise<CardPage> {
  return cached(`cards:${JSON.stringify(params)}:${page}`, async () => {
    if (demoMode) return (await import('./demo/api')).loadCardPage(params, page);
    assertConnection();
    if (params.q) await loadEvents();
    let rows: CardRow[], total: number;
    if (params.sort === 'game' || params.sort === 'rank') {
      const ordered = await orderedCardIds(params);
      total=ordered.length;
      const ids=ordered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
      const fetched=await inChunks(ids,keys=>supabase.from('cards').select(cardColumns).eq('publication_status','published').in('id',keys));
      const byId=new Map(fetched.map(card=>[card.id,card]));
      rows=ids.flatMap(id=>{const row=byId.get(id);return row ? [row] : [];});
    } else {
      const query = baseCards(params);
      const result = await (params.sort === 'newest' ? query.order('created_at',{ascending:false}) : query.order('source_card_id',{nullsFirst:false})).order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      rows = unwrap(result); total = result.count ?? 0;
    }
    return { items: await withImages(rows), total };
  });
}
export async function loadCardPages(params: CardParams, lastPage: number) {
  const pages = await Promise.all(Array.from({length:lastPage + 1},(_,page)=>loadCardPage(params,page)));
  return { items: pages.flatMap(page=>page.items), total:pages[0]?.total ?? 0 };
}
export function loadCard(id: string) { return cached(`card:${id}`, async () => {
  if (demoMode) return (await import('./demo/api')).loadCard(id);
  const row = unwrap(await supabase.from('cards').select(cardColumns).eq('id',id).eq('publication_status','published').maybeSingle());
  return (await withImages([row],1200))[0];
}); }
export type Attendance = ParticipationRow & { person?: PersonRow; team?: TeamRow; roleLabel?: string };
async function enrichAttendance(rows: ParticipationRow[]): Promise<Attendance[]> {
  const [people, teams, roles] = await Promise.all([
    inChunks(rows.map(row=>row.person_id),ids=>supabase.from('people').select(personColumns).in('id',ids)),
    inChunks(rows.flatMap(row=>row.team_id ? [row.team_id] : []),ids=>supabase.from('teams').select('id,event_id,display_name,rank_value,rank_note,final_score').in('id',ids)),
    cached('roles',async()=>unwrap(await supabase.from('roles').select('id,label,kind'))),
  ]);
  const p = new Map(people.map(row=>[row.id,row])), t = new Map(teams.map(row=>[row.id,row])), r = new Map(roles.map(row=>[row.id,row]));
  return rows.map(row=>({...row,person:p.get(row.person_id),team:row.team_id ? t.get(row.team_id) : undefined,roleLabel:row.role_id ? r.get(row.role_id)?.label : undefined}));
}
export function loadEventDetail(id: string) { return cached(`event:${id}`, async () => {
  if (demoMode) return (await import('./demo/api')).loadEventDetail(id);
  const [events,teams,participations,links,preview] = await Promise.all([
    loadEvents(),
    supabase.from('teams').select('id,event_id,display_name,rank_value,rank_note,final_score').eq('event_id',id).order('rank_value',{nullsFirst:false}).order('id').then(unwrap),
    allPages((from,to)=>supabase.from('participations').select(participationColumns).eq('event_id',id).eq('status','attended').order('id').range(from,to)),
    supabase.from('resource_links').select('id,person_id,event_id,kind,label,url').eq('event_id',id).order('id').then(unwrap),
    loadCardPage({eventId:id,type:'',sort:'game'},0),
  ]);
  const event = events.find(event=>event.id === id); if (!event) throw new Error('ゲームが見つかりませんでした。');
  const attendance = await enrichAttendance(participations);
  return { event, teams, attendance, links, preview };
}); }
export function loadPerson(id: string) { return cached(`person:${id}`,async()=>{
  if (demoMode) return (await import('./demo/api')).loadPerson(id);
  const [person,events,rows,names,links,period] = await Promise.all([
    supabase.from('people').select(personColumns).eq('id',id).maybeSingle().then(unwrap),loadEvents(),
    allPages((from,to)=>supabase.from('participations').select(participationColumns).eq('person_id',id).eq('status','attended').order('id').range(from,to)),
    supabase.from('person_names').select('person_id,name').eq('person_id',id).then(unwrap),
    supabase.from('resource_links').select('id,person_id,event_id,kind,label,url').eq('person_id',id).then(unwrap),
    cached('dp-period',async()=>{const result=await supabase.from('dp_periods').select('id,code').order('code',{ascending:false}).limit(1).maybeSingle();if(result.error)throw new Error(result.error.message);return result.data;}),
  ]);
  const [attendance,dp] = await Promise.all([enrichAttendance(rows),period ? supabase.from('dp_records').select('person_id,period_id,points').eq('person_id',id).eq('period_id',period.id).maybeSingle().then(result=>{if(result.error)throw new Error(result.error.message);return result.data?.points ?? null;}) : Promise.resolve(null)]);
  const history = attendance.map(row=>({...row,event:events.find(event=>event.id === row.event_id)})).sort((a,b)=>(b.event?.fiscal_year ?? 0)-(a.event?.fiscal_year ?? 0)||(b.event?.start_date ?? '').localeCompare(a.event?.start_date ?? ''));
  return {person,history,names,links,dp};
}); }
export type SearchPage = { items: ResultItem[]; total: number };
export function loadSearch(kind: ResultItem['kind'], query: string, page = 0): Promise<SearchPage> {
  return cached(`search:${kind}:${query}:${page}`,async()=>{
    if (demoMode) return (await import('./demo/api')).loadSearch(kind, query, page);
    const q=searchLiteral(query); if (!q) return {items:[],total:0};
    if (kind === 'game') {
      const events=(await loadEvents()).filter(event=>[event.name,event.fiscal_year,event.theme].some(value=>String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja').includes(q)));
      return {items:events.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(event=>({id:event.id,kind,title:event.name,subtitle:event.schedule_note ?? (event.fiscal_year ? `${event.fiscal_year}年` : '')})),total:events.length};
    }
    if (kind === 'card') {
      const cards=await loadCardPage({type:'',sort:'number',q:query},page);
      return {items:cards.items.map(card=>{
        rememberCardPreview(card);
        return {id:card.id,kind,title:card.name,subtitle:cardSubtitle(card),image:card.imageUrl,originalImageUrl:card.originalImageUrl};
      }),total:cards.total};
    }
    const personIds=await cached(`person-search-ids:${q}`,async()=>{
      const [names,participations,teams]=await Promise.all([
        allPages((from,to)=>supabase.from('person_names').select('person_id,name').ilike('name',`%${q}%`).order('person_id').order('name').range(from,to)),
        allPages((from,to)=>supabase.from('participations').select('person_id,id').eq('status','attended').ilike('name_at_event',`%${q}%`).order('id').range(from,to)),
        supabase.from('teams').select('id').ilike('display_name',`%${q}%`).then(unwrap),
      ]);
      const teamIds=teams.map(team=>team.id);
      const teamPeople=(await Promise.all(Array.from({length:Math.ceil(teamIds.length/200)},(_,index)=>allPages((from,to)=>supabase.from('participations').select('id,person_id').eq('status','attended').in('team_id',teamIds.slice(index*200,(index+1)*200)).order('id').range(from,to))))).flat();
      return [...new Set([...names,...participations,...teamPeople].map(row=>row.person_id))];
    });
    // Supabase URL limits: merge filtered directory matches and alias matches by UUID before slicing.
    const matches=await cached(`person-search:${q}`,async()=>{
      const [direct,aliases]=await Promise.all([
        allPages((from,to)=>supabase.from('people').select(personColumns).or(`display_name.ilike.%${q}%,code_name.ilike.%${q}%`).order('id').range(from,to)),
        inChunks(personIds,ids=>supabase.from('people').select(personColumns).in('id',ids)),
      ]);
      return [...new Map([...direct,...aliases].map(person=>[person.id,person])).values()].sort((a,b)=>a.display_name.localeCompare(b.display_name,'ja')||a.id.localeCompare(b.id));
    });
    return {items:matches.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(person=>({id:person.id,kind,title:person.display_name,subtitle:personSubtitle(person)})),total:matches.length};
  });
}
export async function loadSearchPages(kind: ResultItem['kind'], query: string, lastPage: number) {
  const pages=await Promise.all(Array.from({length:lastPage+1},(_,page)=>loadSearch(kind,query,page)));
  return {items:pages.flatMap(page=>page.items),total:pages[0]?.total ?? 0};
}
