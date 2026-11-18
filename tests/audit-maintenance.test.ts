import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { imageDimensionSql, verifiedCardsSql } from '../scripts/lib/audit-maintenance.mjs';

const id = '11111111-1111-4111-8111-111111111111', cardId = '22222222-2222-4222-8222-222222222222';
const measurement = { id, card_id:cardId, storage_path:'original.jpg',external_url:null,checksum_sha256:'original-hash',width:null,height:null,measured_width:600,measured_height:900,error:null };
async function imageDb() {
  const db=new PGlite();
  await db.exec('create table card_images(id uuid primary key,card_id uuid,storage_path text,external_url text,checksum_sha256 text,width int,height int);');
  await db.query('insert into card_images values($1,$2,$3,null,$4,null,null)',[id,cardId,'original.jpg','original-hash']);
  return db;
}
test('measured dimensions apply atomically, are idempotent, and can be rolled back',async()=>{
  const db=await imageDb();
  try {
    await db.exec(imageDimensionSql([measurement]));
    await db.exec(imageDimensionSql([measurement]));
    assert.deepEqual((await db.query('select width,height from card_images')).rows,[{width:600,height:900}]);
    await db.exec(imageDimensionSql([measurement],true));
    assert.deepEqual((await db.query('select width,height from card_images')).rows,[{width:null,height:null}]);
  } finally {await db.close();}
});
test('a changed image source or later dimensions aborts the entire maintenance batch',async()=>{
  const db=await imageDb();
  try {
    const second={...measurement,id:'33333333-3333-4333-8333-333333333333'};
    await db.query('insert into card_images values($1,$2,$3,null,$4,null,null)',[second.id,cardId,'different-source.jpg','original-hash']);
    await assert.rejects(db.exec(imageDimensionSql([measurement,second])),/changed since measurement/);
    await db.exec('rollback;');
    assert.equal((await db.query<{n:number}>('select count(*)::int as n from card_images where width is not null')).rows[0].n,0);
    await db.exec(imageDimensionSql([measurement]));
    await db.exec('update card_images set width=700;');
    await assert.rejects(db.exec(imageDimensionSql([measurement],true)),/changed since measurement/);
    await db.exec('rollback;');
    assert.equal((await db.query<{width:number}>('select width from card_images where id=$1',[id])).rows[0].width,700);
  } finally {await db.close();}
});
test('verified cards retain IDs and publication; concurrent edits prevent all corrections',async()=>{
  const db=new PGlite();
  const before={id:cardId,event_id:id,source_card_id:'OCR-source',publication_status:'published',name:'元画像',rank:null,card_type:'defence',source_type:'defence',effect_text:'不完全'};
  const after={...before,rank:'a',card_type:'spell',source_type:'spell',effect_text:'元画像で確認した効果'};
  try {
    await db.exec('create table cards(id uuid primary key,event_id uuid,source_card_id text,publication_status text,name text,rank text,card_type text,source_type text,effect_text text);');
    await db.query('insert into cards select * from jsonb_populate_record(null::cards,$1::jsonb)',[JSON.stringify(before)]);
    await db.exec(verifiedCardsSql([{before,after}]));
    await db.exec(verifiedCardsSql([{before,after}]));
    assert.deepEqual((await db.query('select * from cards')).rows,[after]);
    await db.exec(verifiedCardsSql([{before,after}],true));
    assert.deepEqual((await db.query('select * from cards')).rows,[before]);
    const secondBefore={...before,id:'44444444-4444-4444-8444-444444444444'};
    await db.query('insert into cards select * from jsonb_populate_record(null::cards,$1::jsonb)',[JSON.stringify({...secondBefore,effect_text:'他の人による編集'})]);
    await assert.rejects(db.exec(verifiedCardsSql([{before,after},{before:secondBefore,after:{...after,id:secondBefore.id}}])),/changed since verification/);
    await db.exec('rollback;');
    assert.deepEqual((await db.query('select * from cards where id=$1',[cardId])).rows,[before]);
  } finally {await db.close();}
});
test('invalid measurements and repeated IDs never produce an update query',()=>{
  assert.throws(()=>imageDimensionSql([{...measurement,measured_width:0}]),/Unverified/);
  assert.throws(()=>imageDimensionSql([measurement,measurement]),/duplicate/);
});

test('source-verified participation correction preserves the row, is reversible, and rejects changed identities',async()=>{
  const folder=new URL('./fixtures/participation-correction/',import.meta.url);
  for(const suffix of ['', 'canada-']) {
  const correction=JSON.parse(await readFile(new URL(`verified-${suffix}participation-correction.json`,folder),'utf8'));
  const apply=await readFile(new URL(`apply-verified-${suffix}participation.sql`,folder),'utf8');
  const rollback=await readFile(new URL(`rollback-verified-${suffix}participation.sql`,folder),'utf8');
  const db=new PGlite();
  try {
    await db.exec('create table people(id uuid primary key,display_name text,code_name text,joined_year int); create table participations(id uuid primary key,person_id uuid,event_id uuid,team_id uuid,role_id uuid,kind text,name_at_event text,status text,grade_at_event int);');
    await db.query('insert into people select * from jsonb_populate_record(null::people,$1::jsonb)',[JSON.stringify(correction.target_person)]);
    await db.query('insert into participations select * from jsonb_populate_record(null::participations,$1::jsonb)',[JSON.stringify(correction.before)]);
    await db.exec(apply);await db.exec(apply);
    assert.deepEqual((await db.query('select * from participations')).rows,[correction.after]);
    await db.exec(rollback);
    assert.deepEqual((await db.query('select * from participations')).rows,[correction.before]);
    await db.exec('update people set joined_year=2022;');
    await assert.rejects(db.exec(apply),/target person changed/);
    await db.exec('rollback;');
    assert.deepEqual((await db.query('select * from participations')).rows,[correction.before]);
  } finally {await db.close();}
  }
});
