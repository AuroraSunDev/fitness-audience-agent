import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDateCalendar } from '../src/date-calendar.mjs';

test('calendar marks the selected day and disables dates without available reports',()=>{
  const html=renderDateCalendar('2026-11-14',['2026-11-13','2026-11-14'],'data-action','plan-date-');
  assert.match(html,/aria-label="2026-11-14" aria-pressed="true"/);
  assert.match(html,/data-action="plan-date-2026-11-13"[^>]*aria-pressed="false"/);
  assert.match(html,/data-action="plan-date-2026-11-15"[^>]*disabled/);
});
