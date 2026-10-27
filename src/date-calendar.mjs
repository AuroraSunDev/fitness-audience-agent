export function renderDateCalendar(selectedDate, availableDates, actionAttribute, actionPrefix) {
  const [year, month] = selectedDate.split('-').map(Number);
  const firstDay = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const allowed = new Set(availableDates);
  const cells = Array.from({ length: firstDay }, () => '<span class="date-calendar-empty"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push(`<button type="button" ${actionAttribute}="${actionPrefix}${date}" aria-label="${date}" aria-pressed="${date === selectedDate}" ${allowed.has(date) ? '' : 'disabled'} class="${date === selectedDate ? 'selected' : ''}">${day}</button>`);
  }
  return `<div class="date-calendar" role="group" aria-label="选择分析日期"><strong>${year}年${month}月</strong><div class="date-calendar-grid">${['一','二','三','四','五','六','日'].map(day => `<span class="date-calendar-weekday">${day}</span>`).join('')}${cells.join('')}</div></div>`;
}
