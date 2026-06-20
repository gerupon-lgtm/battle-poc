// =====================================================
// battle-tantan.js  -- たんたん案
// 流れ:
//   1. リズムゲームを行う。獲得点数によって選択肢数が絞られる。
//   2. クイズ表示。正解=敵にダメージ / 不正解=自分にダメージ。
//   3. 解説は問題ごとに表示。
//   4. どちらかの HP が 0 になるまで繰り返す。
// 調整パラメータは CONFIG にまとめてある。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    // リズムスコア → 選択肢数(高スコアほど少ない=易しい)
    SCORE_FOR_2_CHOICES: 4800,
    SCORE_FOR_3_CHOICES: 2400,
    // 正解時に敵へ与える基礎ダメージ
    CORRECT_BASE_DAMAGE: 14,
    // リズムを撃破(クリア)していた場合の追加ダメージ
    CLEAR_BONUS_DAMAGE: 8,
    // 不正解時に自分が受けるダメージ(敵の攻撃力を使用)
    WRONG_USES_ENEMY_ATTACK: true,
    WRONG_FIXED_DAMAGE: 12,
  };

  function choicesFromScore(score) {
    if (score >= CONFIG.SCORE_FOR_2_CHOICES) return 2;
    if (score >= CONFIG.SCORE_FOR_3_CHOICES) return 3;
    return 4;
  }

  async function run(core) {
    while (!core.isOver()) {
      // 1. リズムラウンド
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
        let dmg = CONFIG.CORRECT_BASE_DAMAGE + (rr.cleared ? CONFIG.CLEAR_BONUS_DAMAGE : 0);
        core.damageEnemy(dmg);
        core.log("正解! " + core.state.enemy.name + "に " + dmg + " ダメージ", "good");
      } else {
        const dmg = CONFIG.WRONG_USES_ENEMY_ATTACK
          ? core.state.enemy.attack
          : CONFIG.WRONG_FIXED_DAMAGE;
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
