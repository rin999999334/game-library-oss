import { useEffect, useMemo, useRef, useState } from 'react';
import { cardSortLabels } from './CardMenu';
import { CardArtwork, ExpandedCardImage } from './CardArtwork';
import './home-library.css';
import './list-motion.css';
import { loadCard, loadCardPages, loadEvents, loadEventDetail, loadPerson, loadSearch, loadSearchPages, type Attendance, type CardPage } from './api';
import { useAutoPage, useDebounced, useResource } from './hooks';
import { cardSubtitle, gameYear, gameYears, orderGames, rankedTeams, rankLabel, typeLabel, type CardParams, type CardSort, type ResultItem, type Card } from './model';
import type { TeamRow } from './database';
import type { Navigation } from './navigation';
import { displayTeamName } from './team-name';
import { ExternalLinks, Gallery, GameIcon, Icon, ListRow, ResultRow, Status } from './ui';
import { cardPreview, rememberCardPreview } from './card-preview';
export type HomeSort = 'year-desc' | 'year-asc' | 'name';
export type CardView = {game?:string;sort:CardSort;page:number};
export const homeLabels:Record<HomeSort,string>={'year-desc':'開催年（新しい順）','year-asc':'開催年（古い順）',name:'年代内の五十音順'};
export type OpenResult = (item:ResultItem,sequence?:string[])=>void;
const emptyCards:Card[]=[];
export function Home({sort,year,open}:{sort:HomeSort;year:string;open:OpenResult}) {
  const resource=useResource('events',loadEvents);
  const ordered=orderGames(resource.data ?? []);
  const events=(sort==='year-asc' ? ordered.reverse() : ordered).filter(event=>!year || (gameYear(event)===null ? 'unknown' : String(gameYear(event)))===year);
  const years:(number|null)[]=[...gameYears(events)].sort((a,b)=>sort==='year-asc' ? a-b : b-a);
  if(events.some(event=>gameYear(event)===null))years.push(null);
  return <Status {...resource} empty={resource.data&&events.length===0 ? (year ? '該当するゲームがありません' : 'ゲームがありません') : undefined}>
    <div className="home-library-summary"><span className="library-count">{events.length}タイトル</span><span className="home-library-context">{year ? (year==='unknown' ? '年代未登録' : year+'年')+' · ' : ''}{homeLabels[sort]}</span></div>
    {years.map(value=>{
      const group=events.filter(event=>gameYear(event)===value);
      const sorted=sort==='name' ? [...group].sort((a,b)=>a.name.localeCompare(b.name,'ja')) : group;
      const headingId='home-year-'+(value ?? 'unknown');
      return <section className="home-library-section" key={value ?? 'unknown'} aria-labelledby={headingId}>
        <h2 id={headingId} className="home-library-year">{value===null ? '年代未登録' : value+'年'}</h2>
        <div className="grid">{sorted.map(event=><button className="game" key={event.id} onClick={()=>open({id:event.id,kind:'game',title:event.name,subtitle:event.schedule_note ?? ''})}><span className="game-tile"><GameIcon eventId={event.id} name={event.name}/></span><span className="label">{event.name}</span></button>)}</div>
      </section>;
    })}
  </Status>;
}
export function Cards({eventId,view,setView,open}:{eventId?:string;view:CardView;setView:(next:CardView|((current:CardView)=>CardView))=>void;open:OpenResult}) {
  const selectedGame=view.game ?? eventId ?? '';
  const params:CardParams={eventId:selectedGame||undefined,type:'',sort:view.sort};
  const criteria=JSON.stringify(params), previous=useRef<{criteria:string;data:CardPage}|null>(null);
  const events=useResource('events',loadEvents);
  const resource=useResource(`card-pages:${criteria}:${view.page}`,()=>loadCardPages(params,view.page));
  if(resource.data)previous.current={criteria,data:resource.data};
  const data=resource.data ?? (previous.current?.criteria===criteria ? previous.current.data : undefined);
  const items=data?.items ?? emptyCards;
  const groups=useMemo(()=>{
    const grouped:{eventId:string;cards:Card[]}[]=[];
    for(const card of items){const last=grouped.at(-1);if(last?.eventId===card.event_id)last.cards.push(card);else grouped.push({eventId:card.event_id,cards:[card]});}
    return grouped;
  },[items]);
  const sequence=useMemo(()=>items.map(card=>card.id),[items]);
  const onOpen=(card:Card)=>open({id:card.id,kind:'card',title:card.name,subtitle:cardSubtitle(card),image:card.imageUrl},sequence);
  const sentinel=useAutoPage(Boolean(data&&items.length<data.total&&!resource.loading&&!resource.error),items.length,()=>setView(current=>current.game===view.game&&current.sort===view.sort&&current.page===view.page ? {...current,page:current.page+1} : current));
  return <><div className="card-list-summary"><span className="library-count">{data ? data.total+'枚' : 'カード'}</span><span className="card-list-context">{selectedGame ? (events.data?.find(event=>event.id===selectedGame)?.name ?? 'ゲーム')+' · ' : ''}{cardSortLabels[view.sort]}</span></div><Status loading={resource.loading&&!data} error={data ? undefined : resource.error} retry={resource.retry} empty={data?.items.length===0 ? '公開カードがありません' : undefined}>{view.sort==='game' ? groups.map(group=><section className="card-game-section" key={group.eventId}><h2 className="section-title">{events.data?.find(event=>event.id===group.eventId)?.name ?? 'ゲーム'}</h2><Gallery cards={group.cards} onOpen={onOpen}/></section>) : <Gallery cards={items} onOpen={onOpen}/>}{data && items.length<data.total ? <div ref={sentinel} className="page-sentinel" role="status" aria-live="polite">{resource.error ? <><span>続きを読み込めませんでした。</span><button className="search-text-btn" onClick={resource.retry}>再試行</button></> : resource.loading ? '読み込み中…' : null}</div> : null}<div className="gallery-footer" aria-live="polite">{items.length} / {data?.total ?? 0}枚</div></Status></>;
}
function Heading({title,count}:{title:string;count:string|number}) {return <h2 className="section-title"><span>{title}<span className="section-count">({count})</span></span></h2>;}
function Rankings({teams}:{teams:TeamRow[]}) {
  const [expanded,setExpanded]=useState(false);const ranked=rankedTeams(teams);
  if(!ranked.length)return null;
  const row=(team:TeamRow)=><tr key={team.id} className={team.rank_value!==null ? 'rank-'+team.rank_value : undefined}><td className="col-num">{team.rank_value ?? team.rank_note}</td><td className="col-team">{team.display_name}</td><td className="col-pts">{team.final_score===null ? '—' : team.final_score.toLocaleString('ja-JP')}</td></tr>;
  return <section><Heading title="順位" count={'全'+ranked.length+'チーム'}/><table className="simple-table" aria-label="チームの順位"><thead><tr><th scope="col" className="col-num">順位</th><th scope="col" className="col-team">チーム</th><th scope="col" className="col-pts">得点</th></tr></thead><tbody>{ranked.slice(0,3).map(row)}</tbody><tbody id="ranks" className="ranking-extra-rows" hidden={!expanded}>{ranked.slice(3).map(row)}</tbody></table>{ranked.length>3 ? <button className="table-expand-btn" aria-expanded={expanded} aria-controls="ranks" onClick={()=>setExpanded(!expanded)}><span>{expanded ? '残りのチームを閉じる' : '残りのチームを表示（'+(ranked.length-3)+'チーム）'}</span><Icon name="down"/></button> : null}</section>;
}
function PeopleTable({attendance,open}:{attendance:Attendance[];open:OpenResult}) {return <table className="simple-table part-table" aria-label="参加者と所属チーム"><colgroup><col className="avatar-column"/><col/><col className="team-column"/></colgroup><thead><tr><th scope="col" colSpan={2}>参加者</th><th scope="col" className="part-team">所属チーム</th></tr></thead><tbody>{attendance.map(row=>{
  const name=row.name_at_event ?? row.person?.display_name ?? '名前未登録';
  const team=row.team ? displayTeamName(row.team.display_name) : row.roleLabel;
  return <tr key={row.id}><td className="col-avatar" aria-hidden="true"><span className="table-avatar">{name.slice(0,1)}</span></td><td><button className="part-name" onClick={()=>open({id:row.person_id,kind:'person',title:row.person?.display_name ?? name,subtitle:team ?? ''})}>{name}</button></td><td className="part-team" title={row.team?.display_name}>{team ?? '—'}</td></tr>;
})}</tbody></table>;}
export function Game({id,nav,open}:{id:string;nav:Navigation;open:OpenResult}) {
  const resource=useResource(`event:${id}`,()=>loadEventDetail(id)),data=resource.data;
  const masters=data?.attendance.filter(row=>row.kind==='master') ?? [],people=data?.attendance.filter(row=>row.kind!=='master') ?? [];
  return <Status {...resource}>{data ? <><section className="game-hero"><h2 className="game-name">{data.event.name}</h2><p className="game-date">{data.event.schedule_note ?? ([data.event.start_date,data.event.end_date].filter(Boolean).join(' ～ ') || '開催日未登録')}</p>{data.event.status==='cancelled' ? <span className="badge">開催中止</span> : null}</section>{masters.length ? <div className="game-masters"><span className="meta-label">マスター</span><p>{masters.map(row=><button key={row.id} className="master-link" onClick={()=>open({id:row.person_id,kind:'person',title:row.person?.display_name ?? row.name_at_event ?? '名前未登録',subtitle:'マスター'})}>{row.name_at_event ?? row.person?.display_name ?? '名前未登録'}</button>)}</p></div> : null}<ExternalLinks links={data.links}/><Rankings teams={data.teams}/>{people.length ? <section><Heading title="参加者" count={people.length+'名'}/><PeopleTable attendance={people} open={open}/></section> : null}{data.preview.total ? <section><h2><button className="section-title clickable" onClick={()=>nav.go('game-cards/'+id)}><span>カード<span className="section-count">({data.preview.total})</span></span><Icon name="arrow"/></button></h2><Gallery cards={data.preview.items.slice(0,4)} onOpen={card=>open({id:card.id,kind:'card',title:card.name,subtitle:cardSubtitle(card),image:card.imageUrl},data.preview.items.map(item=>item.id))}/></section> : <p className="empty-desc">公開カードはまだありません。</p>}</> : null}</Status>;
}
export function CardDetail({id,nav,imageOnly=false}:{id:string;nav:Navigation;imageOnly?:boolean}) {
  const resource=useResource(`card:${id}`,()=>loadCard(id)),events=useResource('events',loadEvents),preview=cardPreview(id),card=resource.data ?? preview;
  const sequence=nav.nav.sequence ?? [],index=sequence.indexOf(id),prev=index>0 ? sequence[index-1] : undefined,next=index>=0 ? sequence[index+1] : undefined;
  const event=events.data?.find(event=>event.id===card?.event_id);
  useEffect(()=>{if(!resource.data||imageOnly)return;for(const adjacent of [prev,next])if(adjacent)void loadCard(adjacent).catch(()=>{});},[resource.data,imageOnly,prev,next]);
  return <Status loading={resource.loading&&!card} error={card ? undefined : resource.error} retry={resource.retry}>{card ? imageOnly ? <ExpandedCardImage url={card.originalImageUrl} name={card.name} sizingKey={card.originalImageUrl} fallbackUrl={preview?.imageUrl}/> : <><CardArtwork url={card.imageUrl} name={card.name} sizingKey={card.originalImageUrl||card.imageUrl} fallbackUrl={preview?.imageUrl} onExpand={()=>{rememberCardPreview(card);nav.go('image/'+card.id);}}/><div className="card-identity"><h2>{card.name}</h2><div className="facts"><span className="badge">{typeLabel(card.card_type)}</span>{card.rank ? <span className="badge">ランク {rankLabel(card.rank)}</span> : null}{card.source_card_id ? <span className="badge">{card.source_card_id}</span> : null}</div></div><section><h2 className="meta-label">効果</h2><p className="effect">{card.effect_text || '効果情報はまだ登録されていません。'}</p></section>{card.flavor_text ? <section><h2 className="meta-label">フレーバー</h2><p className="effect">{card.flavor_text}</p></section> : null}<div className="list"><ListRow title={event?.name ?? '所属ゲーム'} sub="所属ゲーム" onClick={()=>nav.go('game/'+card.event_id)}/></div>{prev||next ? <nav className="pager-nav" aria-label="カードの前後移動">{prev ? <button className="pager-btn" onClick={()=>nav.go('card/'+prev,{replace:true})}><Icon name="back"/>前のカード</button> : <span/>}{next ? <button className="pager-btn" onClick={()=>nav.go('card/'+next,{replace:true})}>次のカード<Icon name="arrow"/></button> : <span/>}</nav> : null}</> : null}</Status>;
}
export function Person({id,open}:{id:string;open:OpenResult}) {
  const resource=useResource(`person:${id}`,()=>loadPerson(id)),data=resource.data;
  return <Status {...resource}>{data ? <><div className="card-identity"><h2>{data.person.display_name}</h2><div className="facts">{data.person.joined_year ? <span className="badge">{data.person.joined_year}年参加</span> : null}{data.dp!==null ? <span className="badge">{data.dp.toLocaleString('ja-JP')} DP</span> : null}</div>{data.names.length ? <p className="empty-desc">{[...new Set(data.names.map(name=>name.name))].filter(name=>name!==data.person.display_name).join(' · ')}</p> : null}</div><ExternalLinks links={data.links}/><section><Heading title="参加履歴" count={data.history.length}/><div className="list">{data.history.map(row=><ListRow key={row.id} title={row.event?.name ?? 'ゲーム'} sub={[row.name_at_event,row.team ? displayTeamName(row.team.display_name) : undefined,row.roleLabel,row.team?.rank_value!==null&&row.team?.rank_value!==undefined ? row.team.rank_value+'位' : row.team?.rank_note==='最下位' ? '最下位' : ''].filter(Boolean).join(' · ')} onClick={()=>open({id:row.event_id,kind:'game',title:row.event?.name ?? 'ゲーム',subtitle:row.event?.schedule_note ?? ''})}/>)}</div>{!data.history.length ? <p className="empty-desc">参加履歴はまだありません。</p> : null}</section></> : null}</Status>;
}
const kindLabels={game:'ゲーム',card:'カード',person:'参加者'};
function SearchGroup({kind,query,nav,open}:{kind:ResultItem['kind'];query:string;nav:Navigation;open:OpenResult}) {
  const resource=useResource(`search:${kind}:${query}:0`,()=>loadSearch(kind,query)),data=resource.data,limit=kind==='game' ? 4 : 6;
  return <section className="results-group"><h2 className="group-header"><span>{kindLabels[kind]}</span>{data ? <span>{data.total}件</span> : null}</h2><Status {...resource} empty={data?.total===0 ? '該当する'+kindLabels[kind]+'はありません' : undefined}><div className="results-list">{data?.items.slice(0,limit).map(item=><ResultRow item={item} key={item.id} onClick={()=>open(item,kind==='card' ? data.items.map(item=>item.id) : undefined)}/>)}</div>{data&&data.total>limit ? <button className="search-text-btn more-results" onClick={()=>nav.go('search-results/'+kind)}>すべて見る（{data.total}件）<Icon name="arrow"/></button> : null}</Status></section>;
}
export function Search({query,setQuery,nav,open,recent,clearRecent}:{query:string;setQuery:(value:string)=>void;nav:Navigation;open:OpenResult;recent:ResultItem[];clearRecent:()=>void}) {
  const [input,setInput]=useState(query),[composing,setComposing]=useState(false);
  const settled=useDebounced(query.trim());
  return <><div className="search-bar-wrap"><span className="search-input-icon"><Icon name="search"/></span><input className="search-field" type="search" aria-label="ゲーム、カード、参加者を横断検索" placeholder="ゲーム、カード、参加者を横断検索" value={input} autoComplete="off" onCompositionStart={()=>setComposing(true)} onCompositionEnd={event=>{setComposing(false);setQuery(event.currentTarget.value);}} onChange={event=>{setInput(event.target.value);if(!composing)setQuery(event.target.value);}}/><button className="search-clear-btn" hidden={!input} aria-label="検索を消去" onClick={()=>{setInput('');setQuery('');}}><Icon name="clear"/></button></div><div className="search-body" aria-live="polite">{settled ? (['game','card','person'] as const).map(kind=><SearchGroup key={kind} kind={kind} query={settled} nav={nav} open={open}/>) : <>{recent.length ? <section className="search-section"><div className="search-header-row"><h2 className="search-label">最近見た項目</h2><button className="search-text-btn" onClick={clearRecent}>履歴を消去</button></div><div className="results-list">{recent.map(item=><ResultRow key={item.kind+item.id} item={item.kind==='person' ? {...item,subtitle:displayTeamName(item.subtitle)} : item} onClick={()=>open(item)}/>)}</div></section> : null}</>}</div></>;
}
export function SearchResults({kind,query,page,setPage,open}:{kind:ResultItem['kind'];query:string;page:number;setPage:(page:number)=>void;open:OpenResult}) {
  const resource=useResource(`search-pages:${kind}:${query}:${page}`,()=>loadSearchPages(kind,query,page)),data=resource.data;
  return <Status {...resource} empty={!query || data?.total===0 ? '検索キーワードを入力してください' : undefined}><div className="results-list">{data?.items.map(item=><ResultRow key={item.id} item={item} onClick={()=>open(item,kind==='card' ? data.items.map(item=>item.id) : undefined)}/>)}</div>{data&&data.items.length<data.total ? <button className="pager-btn load-more" onClick={()=>setPage(page+1)}>さらに見る<Icon name="down"/></button> : null}<div className="gallery-footer">{data?.items.length ?? 0} / {data?.total ?? 0}件</div></Status>;
}
export function resultForCard(card:Card):ResultItem {return {id:card.id,kind:'card',title:card.name,subtitle:cardSubtitle(card),image:card.imageUrl};}
