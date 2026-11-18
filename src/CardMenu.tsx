import { useId, useState } from 'react';
import { loadEvents } from './api';
import { useResource } from './hooks';
import { normaliseSearch, orderGames, type CardSort } from './model';
import { Icon, Status } from './ui';
import { FilterSheet } from './FilterSheet';

export const cardSortLabels: Record<CardSort, string> = {
  game: 'ゲーム別（新しい順）', number: '番号順', newest: '新着順', rank: 'ランク順',
};

export function CardMenu({ gameId, sort, onChange }: {
  gameId: string; sort: CardSort; onChange: (game: string, sort: CardSort) => void;
}) {
  const events = useResource('events', loadEvents);
  const id = useId();
  const [draftGame, setDraftGame] = useState(gameId), [draftSort, setDraftSort] = useState(sort);
  const [query, setQuery] = useState('');
  const active = Boolean(gameId);
  const selected = events.data?.find(game => game.id === gameId);
  const visible = orderGames(events.data ?? []).filter(game => normaliseSearch(game.name).includes(normaliseSearch(query)));
  return <FilterSheet label={active ? `カードの絞り込み：${selected?.name ?? 'ゲームを選択中'}` : 'カードの絞り込み'}
    active={active} onOpen={() => { setDraftGame(gameId); setDraftSort(sort); setQuery(''); }}
    onClear={() => onChange('', sort)} onReset={() => setDraftGame('')} resetDisabled={!draftGame}
    onApply={() => onChange(draftGame, draftSort)}>
        <fieldset className="filter-section"><legend>並び順</legend><div className="filter-options">
          {(Object.keys(cardSortLabels) as CardSort[]).map(value => <label className="filter-option" key={value}>
            <span>{cardSortLabels[value]}</span><input className="filter-radio" type="radio" name={id + '-sort'}
              value={value} checked={draftSort === value} onChange={() => setDraftSort(value)}/>
          </label>)}
        </div></fieldset>
        <fieldset className="filter-section"><legend>ゲーム</legend>
          <div className="filter-game-search"><Icon name="search"/><input type="search" placeholder="ゲーム名で探す"
            aria-label="絞り込みのゲームを検索" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)}/>
            {query ? <button className="icon-button" aria-label="ゲーム名の検索を消去" onClick={() => setQuery('')}><Icon name="clear"/></button> : null}
          </div>
          <div className="filter-options"><label className="filter-option"><span>すべてのゲーム</span>
            <input className="filter-radio" type="radio" name={id + '-game'} value="" checked={!draftGame} onChange={() => setDraftGame('')}/>
          </label><Status {...events}>{visible.map(game => <label className="filter-option" key={game.id}>
            <span>{game.name}</span><input className="filter-radio" type="radio" name={id + '-game'} value={game.id}
              checked={draftGame === game.id} onChange={() => setDraftGame(game.id)}/>
          </label>)}{!visible.length ? <p className="menu-empty">ゲームが見つかりません</p> : null}</Status></div>
        </fieldset>
  </FilterSheet>;
}
