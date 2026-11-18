import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSlices, searchLiteral, searchClassifier, safeExternalUrl, rankLabel, typeLabel, compareCardIds, compareCards, compareCardsInGame, cardRankOrder, cardTypeOrder } from '../src/model';
import { cached, forget, peek } from '../src/cache';
test('rank pages span bucket boundaries without duplicates or missing rows',()=>{
 const counts=[2,30,17,0,0,0,3],seen:string[]=[];
 for(let page=0;page<3;page++)for(const slice of pageSlices(counts,page))for(let index=slice.from;index<=slice.to;index++)seen.push(slice.bucket+':'+index);
 assert.equal(seen.length,52);assert.equal(new Set(seen).size,52);assert.deepEqual(pageSlices(counts,0),[{bucket:0,from:0,to:1},{bucket:1,from:0,to:21}]);
});
test('search treats Japanese types and full-width ranks as structured filters',()=>{
 assert.equal(searchClassifier('ランク ＳＳ').rank,'ss');assert.equal(searchClassifier('特殊').type,'special');assert.equal(rankLabel('ss'),'SS');
 assert.equal(searchLiteral('name%,id.eq.foo,(attack)_'),'name id eq foo attack');
});
test('the admin guard card type keeps the public defense label',()=>{
 assert.equal(typeLabel('guard'),'防御');assert.equal(typeLabel('defence'),'防御');
});
test('external links allow web URLs and reject script and credential URLs',()=>{
 assert.equal(safeExternalUrl('javascript:alert(1)'),null);assert.equal(safeExternalUrl('https://user:pass@example.com'),null);assert.equal(safeExternalUrl('https://example.com/path'),'https://example.com/path');
});
test('simultaneous requests share work; failures do not poison retries',async()=>{
 let calls=0;const request=async()=>{calls++;return {value:42};};
 const [a,b]=await Promise.all([cached('test-ok',request),cached('test-ok',request)]);assert.equal(calls,1);assert.strictEqual(a,b);assert.deepEqual(peek('test-ok'),{value:42});forget('test-ok');
 await assert.rejects(cached('test-failed',async()=>{throw Error('offline');}));assert.equal(await cached('test-failed',async()=>7),7);
});

test('games descend by year and date; each card group follows display ID then rank, type, and name',async()=>{
 const {orderGames,orderCardDirectory}=await import('../src/model');
 const base={name:'ゲーム',fiscal_year:2025,start_date:'2025-01-01',end_date:null,schedule_note:null,status:null,theme:null};
 const events=[{...base,id:'older'},{...base,id:'newer',start_date:'2025-12-01'},{...base,id:'latest',fiscal_year:2026,start_date:'2026-01-01'}];
 assert.deepEqual(orderGames(events).map(event=>event.id),['latest','newer','older']);
 const card={source_card_id:'C1',rank:'A',card_type:'attack'};
 const cards=[{...card,id:'a10',event_id:'newer',source_card_id:'C10',name:'あ'},{...card,id:'old',event_id:'older',name:'い',rank:'SS'},{...card,id:'a2',event_id:'newer',source_card_id:'C2',name:'い'},{...card,id:'latest',event_id:'latest',name:'う',rank:'D'},{...card,id:'guard',event_id:'newer',name:'あ',card_type:'guard'},{...card,id:'ss',event_id:'newer',name:'わ',rank:'SS',card_type:'spell'}];
 assert.deepEqual(orderCardDirectory(cards,events).map(card=>card.id),['latest','ss','guard','a2','a10','old']);
 assert.equal(cards[0].id,'a10');
});

test('display card IDs use natural numeric order, normalized width, and empty values last',()=>{
 assert.ok(compareCardIds('C2','C10')<0);
 assert.ok(compareCardIds('2','10')<0);
 assert.ok(compareCardIds(' Ｃ２ ','C10')<0);
 assert.equal(compareCardIds('Ｃ２','C2'),0);
 for(const missing of [null,undefined,'','  ','　']) {
  assert.ok(compareCardIds('10',missing)<0);
  assert.ok(compareCardIds(missing,'10')>0);
 }
 assert.equal(compareCardIds(null,''),0);
 assert.equal(compareCardIds('　',undefined),0);
});

test('cards in a game prioritize display IDs, and equal IDs then use rank, type, name and UUID ties',()=>{
 const base={source_card_id:'C2',rank:'SS',card_type:'attack',name:'あ'};
 const cards=[
  {...base,id:'uuid-a',source_card_id:'C10'},
  {...base,id:'uuid-z',rank:'D'},
  {...base,id:'tie-i',name:'い'},
  {...base,id:'tie-a',source_card_id:'Ｃ２'},
  {...base,id:'guard',card_type:'defense'},
  {...base,id:'quick',card_type:'quick'},
  {...base,id:'spell',card_type:'spell'},
  {...base,id:'blank',source_card_id:null},
 ];
 assert.deepEqual([...cards].sort(compareCardsInGame).map(card=>card.id),['tie-a','tie-i','guard','quick','spell','uuid-z','uuid-a','blank']);
 assert.ok(compareCardsInGame(cards[1],cards[0])<0);
 assert.ok(compareCards(cards[1],cards[0])>0);
 assert.equal(compareCardsInGame({...base,id:'a'},{...base,id:'b'}),-1);
});

test('card ranking normalizes legacy values and puts missing ranks and types last',()=>{
 assert.deepEqual(['SS','s','Ａ','b','C','d','?','',null].map(cardRankOrder),[0,1,2,3,4,5,6,6,6]);
 assert.deepEqual(['attack','guard','defence','defense','quick','spell','special','other',null].map(cardTypeOrder),[0,1,1,1,2,3,4,5,6]);
 const base={rank:'A',name:'あ'};
 const cards=[{...base,id:'unknown',card_type:null},{...base,id:'spell',card_type:'spell'},{...base,id:'attack',card_type:'attack'},{...base,id:'quick',card_type:'quick'},{...base,id:'special',card_type:'special'},{...base,id:'guard',card_type:'guard'},{...base,id:'other',card_type:'other'},{...base,id:'rank-unknown',rank:null,card_type:'attack'}];
 assert.deepEqual(cards.sort(compareCards).map(card=>card.id),['attack','guard','quick','spell','special','other','unknown','rank-unknown']);
});

test('equal rank and type use normalized Japanese kana names and deterministic IDs',()=>{
 const base={rank:'SS',card_type:'attack'};
 const cards=[{...base,id:'u',name:'う'},{...base,id:'ka-z',name:'ｶ'},{...base,id:'a',name:'あ'},{...base,id:'i',name:'い'},{...base,id:'ka-a',name:'か'}];
 assert.deepEqual(cards.sort(compareCards).map(card=>card.id),['a','i','u','ka-a','ka-z']);
 assert.equal(compareCards({...base,id:'a',name:'か'},{...base,id:'b',name:'カ'}),-1);
 assert.ok(compareCards({...base,id:'z',name:'か'},{...base,id:'a',name:'が'})<0);
 assert.deepEqual(['ぱ','ば','は'].map(name=>({...base,id:name,name})).sort(compareCards).map(row=>row.name),['は','ば','ぱ']);
});

test('named last-place teams are included after numeric ranks without inventing a number',async()=>{
 const {rankedTeams}=await import('../src/model');
 const base={event_id:'game',final_score:null};
 const teams=[
  {...base,id:'last',display_name:'吾妻',rank_value:null,rank_note:'最下位'},
  {...base,id:'fourth',display_name:'外様',rank_value:4,rank_note:'4位'},
  {...base,id:'unknown',display_name:'不明',rank_value:null,rank_note:'？'},
  {...base,id:'winner',display_name:'強国',rank_value:1,rank_note:'優勝'},
  {...base,id:'extra',display_name:'番外',rank_value:null,rank_note:'番外編'},
 ];
 const ranked=rankedTeams(teams);
 assert.deepEqual(ranked.map(team=>team.id),['winner','fourth','last']);
 assert.equal(ranked.at(-1)?.rank_value,null);
 assert.equal(ranked.at(-1)?.rank_note,'最下位');
 assert.equal(teams[0].id,'last');
});

test('home years use registered years first and keep undated games unassigned',async()=>{
 const {gameYear,gameYears}=await import('../src/model');
 const base={id:'game',name:'年度未登録',fiscal_year:null,start_date:null,end_date:null,schedule_note:null,status:null,theme:null};
 assert.equal(gameYear(base),null);
 assert.equal(gameYear({...base,name:'HAL2026'}),null);
 assert.equal(gameYear({...base,start_date:'2025-03-01'}),2025);
 assert.equal(gameYear({...base,fiscal_year:2024,start_date:'2025-03-01'}),2024);
 assert.deepEqual(gameYears([base,{...base,fiscal_year:2024},{...base,start_date:'2025-03-01'},{...base,fiscal_year:2024}]),[2025,2024]);
});
