// =====================================================
// enemy-loader.js
// data/enemies.csv から敵データを読み込む(そらドラゴン固定)。
// 既存の csvLoader.js には依存しない、検証専用の軽量実装。
// =====================================================
(function () {
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

  // enemyId(既定: enemy_008 = そらドラゴン)を読み込む
  async function loadEnemy(enemyId) {
    const id = enemyId || "enemy_008";
    const res = await fetch("./data/enemies.csv");
    const text = await res.text();
    const row = parseCsv(text).find((r) => r.enemy_id === id);
    if (!row) throw new Error("敵データが見つかりません: " + id);
    return {
      id: row.enemy_id,
      name: row.enemy_name,
      hp: Number(row.hp),
      attack: Number(row.attack),
      defense: Number(row.defense),
      image: "./" + row.image, // csv は "assets/enemy_dragon.png"
      expBase: Number(row.exp_base),
      goldBase: Number(row.gold_base),
    };
  }

  window.EnemyLoader = { loadEnemy };
})();
