// =====================================================
// enemy-loader.js
// data/enemies.csv から敵データを読み込む。
//   - loadAll(): 全敵を読み込みキャッシュ
//   - random():  キャッシュからランダムに1体返す(出現はランダム)
//   - loadEnemy(id): ID指定で取得
// 既存の csvLoader.js には依存しない、検証専用の軽量実装。
// =====================================================
(function () {
  let cache = [];

  function parseCsv(text) {
    const lines = text.replace(/\r/g, "").trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      const row = {};
      headers.forEach((h, i) => (row[h] = (cols[i] || "").trim()));
      return row;
    });
  }

  function toEnemy(row) {
    return {
      id: row.enemy_id,
      name: row.enemy_name,
      hp: Number(row.hp),
      attack: Number(row.attack),
      defense: Number(row.defense),
      image: "./" + row.image, // csv は "assets/enemy_xxx.png"
      expBase: Number(row.exp_base),
      goldBase: Number(row.gold_base),
    };
  }

  async function loadAll() {
    if (cache.length) return cache;
    const res = await fetch("./data/enemies.csv");
    const text = await res.text();
    cache = parseCsv(text)
      .filter((r) => r.enemy_id)
      .map(toEnemy);
    if (!cache.length) throw new Error("敵データを読み込めませんでした");
    return cache;
  }

  function random() {
    if (!cache.length) throw new Error("敵データ未読込: 先に loadAll() を呼んでください");
    return cache[Math.floor(Math.random() * cache.length)];
  }

  async function loadEnemy(enemyId) {
    await loadAll();
    const id = enemyId || "enemy_008";
    const e = cache.find((x) => x.id === id);
    if (!e) throw new Error("敵データが見つかりません: " + id);
    return e;
  }

  window.EnemyLoader = { loadAll, random, loadEnemy };
})();
