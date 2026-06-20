// =====================================================
// battle-tantan.js  -- たんたん案
// 流れ:
//   1. リズムゲーム(曲ランダム)を行う。獲得点数によって選択肢数が絞られる。
//   2. クイズ表示。正解=敵にダメージ(30%基準±乱数 + かいしんのいちげき) /
//      不正解=自分にダメージ。
//   3. 解説は問題ごとに表示。
//   4. どちらかの HP が 0 になるまで繰り返す。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    // リズムスコア → 選択肢数(高スコアほど少ない=易しい)
    SCORE_FOR_2_CHOICES: 4800,
    SCORE_FOR_3_CHOICES: 2400,
    // 不正解時に自分が受けるダメージ(敵の攻撃力を使用)
    WRONG_USES_ENEMY_ATTACK: true,
    WRONG_FIXED_DAMAGE: 12,
    // 敵へのダメージ(BattleCore.rollDamage と共通仕様)
    DAMAGE: {
      baseRatio: 0.30, // 敵の元最大HPの30%を基準
      randomRange: 8, // ±8の一様乱数(負数含む)
      min: 1, // 下限
      critChance: 0.02, // かいしんのいちげき発生率(極低確率・将来パラメータ化)
      critMinRatio: 0.70, // 会心時ダメージ: 元最大HPの70%〜
      critMaxRatio: 0.90, // 〜90%
    },
  };

  function choicesFromScore(score) {
    if (score >= CONFIG.SCORE_FOR_2_CHOICES) return 2;
    if (score >= CONFIG.SCORE_FOR_3_CHOICES) return 3;
    return 4;
  }

  async function run(core) {
    const enemy = core.state.enemy;
    while (!core.isOver()) {
      // 1. リズムラウンド(曲ランダム)
      const rr = await core.runRhythmRound(
        "リズムラウンド: ［戦闘開始］を押して演奏。スコアで選択肢数が決まります"
      );
      const choiceCount = choicesFromScore(rr.score);
      core.log(
        "リズム結果 スコア" + rr.score + " / " + rr.combo + "コンボ" +
          (rr.cleared ? "(クリア)" : "") + " → 選択肢 " + choiceCount + "択",
        "info"
      );

      // 2. クイズ
      const quiz = window.QuizEngine.next(choiceCount);
      const ans = await core.showQuiz(quiz, { revealExplanation: true });

      // 3. ダメージ処理
      if (ans.correct) {
        const r = window.BattleCore.rollDamage(core.state.enemyMaxHp, CONFIG.DAMAGE);
        core.damageEnemy(r.damage);
        if (r.crit) {
          core.log("かいしんのいちげき! " + enemy.name + "に " + r.damage + " の大ダメージ!", "crit");
        } else {
          core.log("正解! " + enemy.name + "に " + r.damage + " ダメージ", "good");
        }
      } else {
        const dmg = CONFIG.WRONG_USES_ENEMY_ATTACK ? enemy.attack : CONFIG.WRONG_FIXED_DAMAGE;
        core.damagePlayer(dmg);
        core.log("不正解... 自分に " + dmg + " ダメージ", "bad");
      }
    }

    // 4. 決着
    const outcome = core.result();
    core.showFinish(outcome);
    core.log(outcome === "win" ? "そらドラゴンを撃破した!" : "力尽きてしまった...", "info");
  }

  window.BattleTantan = { run, CONFIG };
})();
