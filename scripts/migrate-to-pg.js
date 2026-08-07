/* ترحيل البيانات من SQLite (store.db) إلى PostgreSQL (Supabase).
   التشغيل:  node scripts/migrate-to-pg.js
   يتطلب:     متغير DATABASE_URL
   ملاحظة:    يمسح بيانات الجداول في قاعدة الهدف أولاً ثم يعيد نسخها (أداة لمرة واحدة).
*/
require('dotenv').config({ quiet: true });

if (!process.env.DATABASE_URL) {
  console.error('يجب تعيين DATABASE_URL أولاً.');
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { Pool } = require('pg');

const TABLES = ['users', 'categories', 'products', 'orders', 'order_items', 'settings', 'banners', 'pages', 'messages', 'delivery_zones'];

(async () => {
  const db = require('../db.js');
  await db.initSchema();
  console.log('تم إنشاء المخطط (schema) في قاعدة الهدف.');

  const sqlite = new DatabaseSync(path.join(__dirname, '..', 'store.db'));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    for (const t of TABLES) {
      await pool.query('DELETE FROM ' + t);
    }
    console.log('تم تنظيف الجداول في قاعدة الهدف.');

    for (const t of TABLES) {
      const rows = sqlite.prepare('SELECT * FROM ' + t).all();
      if (rows.length === 0) { console.log(t + ': 0 صفوف'); continue; }

      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ');
      const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`;
      for (const r of rows) {
        await pool.query(sql, cols.map((c) => (r[c] === null ? null : r[c])));
      }
      console.log(t + ': ' + rows.length + ' صفوف');
    }

    for (const t of TABLES) {
      const hasId = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name='id'",
        [t]
      );
      if (hasId.rowCount === 0) continue;
      await pool.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
        [t]
      );
    }
    console.log('تم تحديث تسلسلات (sequences) المعرفات.');

    console.log('\nاكتمل الترحيل بنجاح.');
  } catch (e) {
    console.error('فشل الترحيل:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    sqlite.close();
  }
})();
