async function get(client, key, fallback = null) {
  const { rows } = await client.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

async function set(client, key, value) {
  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

module.exports = { get, set };

// 美甲收入袋撥款：收入 × 比例，四捨五入到百位（例如 2,134 → 2,100、2,150 → 2,200）
module.exports.nailAllocation = (income, rate) => Math.round((income * rate) / 100 / 100) * 100;
