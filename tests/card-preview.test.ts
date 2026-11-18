import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPreview, imageSize, rememberCardPreview, rememberImageSize } from '../src/card-preview';
import type { Card } from '../src/model';

test('detail handoff expires and never supplies another card', () => {
  const realNow=Date.now;
  let now=100;
  Date.now=()=>now;
  try {
    const card={id:'preview-selected',name:'選択したカード',imageUrl:'thumb.jpg'} as Card;
    rememberCardPreview(card);
    assert.equal(cardPreview(card.id),card);
    assert.equal(cardPreview('unselected'),undefined);
    now+=5*60*1000+1;
    assert.equal(cardPreview(card.id),undefined);
  } finally { Date.now=realNow; }
});

test('landscape dimensions reserve the real ratio and reject invalid loads', () => {
  rememberImageSize('landscape-original',720,360);
  rememberImageSize('landscape-original',0,0);
  rememberImageSize('invalid',Number.NaN,100);
  assert.deepEqual(imageSize('landscape-original'),{width:720,height:360});
  assert.equal(imageSize('invalid'),undefined);
});

test('large browsing sessions evict old handoffs and dimensions', () => {
  for(let index=0;index<121;index++)rememberCardPreview({id:'bounded-'+index} as Card);
  assert.equal(cardPreview('bounded-0'),undefined);
  assert.equal(cardPreview('bounded-120')?.id,'bounded-120');
  for(let index=0;index<401;index++)rememberImageSize('bounded-image-'+index,100,140);
  assert.equal(imageSize('bounded-image-0'),undefined);
  assert.deepEqual(imageSize('bounded-image-400'),{width:100,height:140});
});
