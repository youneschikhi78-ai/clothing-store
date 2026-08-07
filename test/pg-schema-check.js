const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const pg = new PGlite();
  const schema = require('fs').readFileSync(require.resolve('./../db.js'), 'utf8');
  const m = schema.match(/const PG_SCHEMA = `([\s\S]*?)`;/);
  const pgSchema = m[1].replace(/\\\\/g, '\\');
  await pg.exec(pgSchema);
  console.log('SCHEMA OK');

  const toPgSql = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };

  const run = async (sql, params = []) => {
    const r = await pg.query(toPgSql(sql), params);
    return r.rows;
  };

  await run('INSERT INTO categories (name, slug, description, image) VALUES ($1, $2, $3, $4)', ['رجالي', 'men', 'أزياء', '']);
  await run('INSERT INTO products (name, slug, category_id, description, price, stock, featured, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', ['قميص', 'qamis', 1, '', 120, 30, 1, 1]);
  await run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['site_name', 'موضة']);
  await run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['site_name', 'موضة2']);

  const p = await run('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', [1]);
  console.log('product join:', p.length === 1 ? 'OK' : 'FAIL', p[0] && p[0].category_name);

  const st = await run('SELECT key, value FROM settings WHERE key = ?', ['site_name']);
  console.log('upsert settings:', st[0].value === 'موضة2' ? 'OK' : 'FAIL', st[0] && st[0].value);

  const agg = await run("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status = 'delivered'");
  console.log('coalesce:', agg[0].t === 0 ? 'OK' : 'FAIL');

  await run('INSERT INTO orders (name, phone, city, address, total, status) VALUES ($1,$2,$3,$4,$5,$6)', ['خالد','0100','القاهرة','شارع 1', 500, 'delivered']);
  await run('INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES ($1,$2,$3,$4,$5)', [1, 1, 'قميص', 120, 2]);
  const top = await run(`SELECT oi.product_name, SUM(oi.qty) qty, SUM(oi.price * oi.qty) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'delivered' GROUP BY oi.product_id, oi.product_name ORDER BY qty DESC LIMIT 5`);
  console.log('top products:', top[0].qty === 2 ? 'OK' : 'FAIL', JSON.stringify(top[0]));

  const id = await run('INSERT INTO banners (title, subtitle, image, link, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', ['بانر','','','/',1,0]);
  console.log('returning id:', id[0].id === 1 ? 'OK' : 'FAIL');

  await run("UPDATE users SET banned = CASE banned WHEN 1 THEN 0 ELSE 1 END WHERE id = ?", [999]);
  console.log('case toggle: OK');

  console.log('DONE');
  await pg.close();
  process.exit(0);
})().catch((e) => { console.error('PG CHECK FAILED:', e.message); process.exit(1); });
