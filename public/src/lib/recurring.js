const dates = require('./dates');

// 固定支出的下一個日期
function nextDate(dateStr, cycle) {
  const { y, m, d } = dates.parse(dateStr);
  const step = cycle === 'yearly' ? 12 : cycle === 'bimonthly' ? 2 : 1;
  return dates.make(y, m + step, d);
}

// 某個月份裡這筆固定支出的到期日（沒有就回傳 null）
function dueInMonth(sub, monthStart) {
  const monthEnd = dates.addDays(dates.make(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)) + 1, 1), -1);
  let d = sub.next_date;
  // 往回推到不晚於月初附近
  let guard = 0;
  while (d > monthEnd && guard++ < 60) {
    const { y, m, d: day } = dates.parse(d);
    const step = sub.cycle === 'yearly' ? 12 : sub.cycle === 'bimonthly' ? 2 : 1;
    d = dates.make(y, m - step, day);
  }
  guard = 0;
  while (d < monthStart && guard++ < 60) d = nextDate(d, sub.cycle);
  return d >= monthStart && d <= monthEnd ? d : null;
}

module.exports = { nextDate, dueInMonth };
