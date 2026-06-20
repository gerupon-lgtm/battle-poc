// =====================================================
// battle-tantan.js  -- たんたん案
// 流れ:
//   1. リズムゲーム(曲・タップパターンともランダム)を行う。獲得点数で選択肢数が絞られる。
//   2. クイズ表示。正解=敵にダメージ(絶対値基準±乱数 + かいしんのいちげき) /
//      不正解=自分にダメージ。
//   3. 解説は「バトル後」にまとめて表示(トシ案と同様)。
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
      attackBase: 22, // HPに依存しない絶対ダメージ基準(最弱HP20は約1発、HP75は3〜4発)
      randomRange: 8, // ±8の一様乱数(負数含む)
      min: 1,
      critChance: 0.02, // かいしんのいちげき(極低確率・将来パラメータ化)
      critMinRatio: 0.70, // 会心時: 敵の元最大HPの70%〜
      critMaxRatio: 0.90, // 〜90%
    },
  };

  function choicesFromScore(score) {
    if (score >= CONFIG.SCORE_FOR_2_CHOICES) return 2;
    if (score >= CONFIG.SCORE_FOR_3_CHOICES) return 3;
    return 4;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function run(core) {
    const enemy = core.state.enemy;
    const learned = []; // バトル後にまとめて表示する解説
    const patSeq = window.BattleCore.createPatternSequencer();

    while (!core.isOver()) {
      // 1. リズムラウンド(曲はランダム / パターンは順送り。時間切れは同パターン再戦)
      const rr = await core.runRhythmRound(
        "リズムラウンド: ［戦闘開始］を押して演奏。スコアで選択肢数が決まります",
        patSeq.next()
      );
      patSeq.update(rr.cleared);
      const choiceCount = choicesFromScore(rr.score);
      core.log(
        "リズム結果 スコア" + rr.score + " / " + rr.combo + "コンボ" +
          (rr.cleared ? "(クリア)" : "") + " → 選択肢 " + choiceCount + "択",
        "info"
      );

      // 2. クイズ(解説はバトル後にまとめて出すため、ここでは出さない)
      const quiz = window.QuizEngine.next(choiceCount);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);

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

    // 4. 決着 + 解説まとめ(勝利時)
    const outcome = core.result();
    let html = "";
    if (outcome === "win") {
      html += '<p class="bv-finish-lead">出題された問題の解説</p>';
      learned.forEach((q, i) => {
        html +=
          '<div class="bv-explain-item"><strong>Q' + (i + 1) + ". " +
          escapeHtml(q.question.replace(/\n/g, " ")) + "</strong><p>" +
          escapeHtml(q.explanation) + "</p></div>";
      });
    }
    core.showFinish(outcome, html);
    core.log(outcome === "win" ? enemy.name + "を撃破した!" : "力尽きてしまった...", "info");
  }

  window.BattleTantan = { run, CONFIG };
})();
