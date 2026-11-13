// 分期每期本金與利息
// interest_type: none / apr（等額本息）/ fixed_fee（每期固定手續費）
function schedule({ principal, periods, interest_type, apr, fee_per_period }) {
  const rows = [];
  if (interest_type === 'apr' && Number(apr) > 0) {
    const r = Number(apr) / 1200;
    const payment = (principal * r) / (1 - Math.pow(1 + r, -periods));
    let balance = principal;
    for (let k = 1; k <= periods; k++) {
      const interest = Math.round(balance * r);
      let principalPart = Math.round(payment - interest);
      if (k === periods || principalPart > balance) principalPart = balance;
      balance -= principalPart;
      rows.push({ no: k, principal: principalPart, interest });
    }
  } else {
    const base = Math.floor(principal / periods);
    const remainder = principal - base * periods;
    const fee = interest_type === 'fixed_fee' ? Number(fee_per_period) || 0 : 0;
    for (let k = 1; k <= periods; k++) {
      rows.push({ no: k, principal: base + (k === 1 ? remainder : 0), interest: fee });
    }
  }
  return rows;
}

function totals(rows) {
  const interest = rows.reduce((s, r) => s + r.interest, 0);
  const principal = rows.reduce((s, r) => s + r.principal, 0);
  return { interest, total: principal + interest, first: rows[0] ? rows[0].principal + rows[0].interest : 0 };
}

module.exports = { schedule, totals };
