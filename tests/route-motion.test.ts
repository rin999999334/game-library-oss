import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteMotion, type RouteMotion } from '../src/route-motion';
function harness() {
  const transitions: {update:()=>void; finish:()=>void; skipped:boolean}[]=[];
  let kind:RouteMotion|null=null,reduced=false;
  const runner=createRouteMotion({
    reduced:()=>reduced, setKind:value=>{kind=value;},
    start:update=>{
      let finish!:()=>void;
      const finished=new Promise<void>(resolve=>{finish=resolve;});
      const entry={update,finish,skipped:false};transitions.push(entry);
      return {ready:Promise.resolve(),finished,skipTransition:()=>{entry.skipped=true;}};
    },
  });
  return {runner,transitions,kind:()=>kind,reduce:()=>{reduced=true;}};
}
test('rapid navigation commits only the latest route even if skipped callbacks run late',async()=>{
  const h=harness(),pages:string[]=[];
  h.runner.run('forward',()=>pages.push('detail'));
  h.runner.run('tab',()=>pages.push('cards'));
  assert.equal(h.transitions[0].skipped,true);
  h.transitions[1].update();h.transitions[0].update();
  assert.deepEqual(pages,['cards']);
  h.transitions[0].finish();await Promise.resolve();assert.equal(h.kind(),'tab');
  h.transitions[1].finish();await Promise.resolve();assert.equal(h.kind(),null);
});
test('reduced motion commits immediately and invalidates pending animations',()=>{
  const h=harness(),pages:string[]=[];
  h.runner.run('forward',()=>pages.push('detail'));h.reduce();
  h.runner.run('back',()=>pages.push('home'));h.transitions[0].update();
  assert.deepEqual(pages,['home']);assert.equal(h.kind(),null);
});
test('unsupported or rejected transition startup preserves navigation exactly once',()=>{
  let commits=0;
  const fallback=createRouteMotion({reduced:()=>false,setKind:()=>{}});
  fallback.run('forward',()=>commits++);
  const failed=createRouteMotion({reduced:()=>false,setKind:()=>{},start:update=>{update();throw Error('capture failed');}});
  failed.run('forward',()=>commits++);assert.equal(commits,2);
});
test('disposing prevents a delayed callback from updating an unmounted app',()=>{
  const h=harness();let commits=0;
  h.runner.run('tab',()=>commits++);h.runner.dispose();h.transitions[0].update();
  assert.equal(commits,0);assert.equal(h.kind(),null);
});
