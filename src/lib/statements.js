const dates = require('./dates');

// 某一天的消費會落在哪一期帳單（回傳該期結帳日）
function periodEndFor(dateStr, statementDay) {
  const { y, m, d } = dates.parse(dateStr);
  const thisMonth = dates.make(y, m, statementDay);
  return dateStr <= thisMonth ? thisMonth : dates.make(y, m + 1, statementDay);
}

function boundsFor(periodEnd, statementDay, dueDay) {
  const { y, m } = dates.parse(periodEnd);
  const prevEnd = dates.make(y, m - 1, statementDay);
  const periodStart = dates.addDays(prevEnd, 1);
  // 繳款日在結帳日之後的同月，否則就是下個月
  const dueDate = dueDay > statementDay ? dates.make(y, m, dueDay) : dates.make(y, m + 1, dueDay);
  return { periodStart, periodEnd, dueDate };
}

async function getOrCreate(client, account, periodEnd) {
  const b = boundsFor(periodEnd, account.statement_day, account.due_day);
  const { rows } = await client.query(
    `INSERT INTO card_statements (account_id, period_start, period_end, due_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, period_end) DO UPDATE SET account_id = EXCLUDED.account_id
     RETURNING *`,
    [account.id, b.periodStart, b.periodEnd, b.dueDate]
  );
  return rows[0];
}

async function forDate(client, account, dateStr) {
  return getOrCreate(client, account, periodEndFor(dateStr, account.statement_day));
}

async function next(client, account, statement) {
  return forDate(client, account, dates.addDays(statement.period_end, 1));
}

// 帳單摘要 SQL（系統記錄金額 vs 銀行帳單）
const SUMMARY_SQL = `
  SELECT s.*, a.name AS account_name,
    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ta.total
                      WHEN t.type = 'income'  THEN -ta.total ELSE 0 END), 0)::BIGINT AS recorded_amount,
    COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.installment_id IS NOT NULL THEN ta.total ELSE 0 END), 0)::BIGINT AS installment_amount,
    COUNT(t.id) FILTER (WHERE t.type IN ('expense', 'income') AND t.installment_id IS NULL)::INT AS normal_count
  FROM card_statements s
  JOIN accounts a ON a.id = s.account_id
  LEFT JOIN transactions t ON t.statement_id = s.id AND t.affects_balance
  LEFT JOIN v_transaction_amounts ta ON ta.id = t.id
`;

async function summary(client, statementId) {
  const { rows } = await client.query(`${SUMMARY_SQL} WHERE s.id = $1 GROUP BY s.id, a.name`, [statementId]);
  return rows[0] || null;
}

module.exports = { periodEndFor, boundsFor, getOrCreate, forDate, next, summary, SUMMARY_SQL };
