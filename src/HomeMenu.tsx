import { useId, useState } from 'react';
import { loadEvents } from './api';
import { useResource } from './hooks';
import { gameYear, gameYears } from './model';
import { FilterSheet } from './FilterSheet';
import { homeLabels, type HomeSort } from './pages';
import { Status } from './ui';

export function HomeMenu({ year, sort, onChange }: { year: string; sort: HomeSort; onChange: (year: string, sort: HomeSort) => void }) {
  const events = useResource('events', loadEvents), id = useId();
  const [draftYear, setDraftYear] = useState(year), [draftSort, setDraftSort] = useState(sort);
  const years = gameYears(events.data ?? []);
  const hasUnknown = events.data?.some(event => gameYear(event) === null);
  return <FilterSheet label={year ? 'ホームの絞り込み：' + (year === 'unknown' ? '年代未登録' : year + '年') : 'ホームの絞り込み'}
    active={Boolean(year)} onOpen={() => { setDraftYear(year); setDraftSort(sort); }}
    onClear={() => onChange('', sort)} onReset={() => setDraftYear('')} resetDisabled={!draftYear}
    onApply={() => onChange(draftYear, draftSort)}>
    <fieldset className="filter-section"><legend>並び順</legend><div className="filter-options">
      {(Object.keys(homeLabels) as HomeSort[]).map(value => <label className="filter-option" key={value}><span>{homeLabels[value]}</span>
        <input className="filter-radio" type="radio" name={id + '-sort'} value={value} checked={draftSort === value} onChange={() => setDraftSort(value)}/>
      </label>)}
    </div></fieldset>
    <fieldset className="filter-section"><legend>年代</legend><div className="filter-options">
      <label className="filter-option"><span>すべての年代</span><input className="filter-radio" type="radio" name={id + '-year'} value="" checked={!draftYear} onChange={() => setDraftYear('')}/></label>
      <Status {...events}>{years.map(value => <label className="filter-option" key={value}><span>{value}年</span>
        <input className="filter-radio" type="radio" name={id + '-year'} value={value} checked={draftYear === String(value)} onChange={() => setDraftYear(String(value))}/>
      </label>)}{hasUnknown ? <label className="filter-option"><span>年代未登録</span><input className="filter-radio" type="radio" name={id + '-year'} value="unknown" checked={draftYear === 'unknown'} onChange={() => setDraftYear('unknown')}/></label> : null}</Status>
    </div></fieldset>
  </FilterSheet>;
}
