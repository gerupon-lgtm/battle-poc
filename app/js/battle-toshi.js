// =====================================================
// battle-toshi.js  -- トシ案(改)
// 流れ:
//   1. クイズ窓(2〜3択)。正解=敵の守備力半減 / 不正解=そのまま。
//   2. 防御リズム。クリア=敵にダメージ / 時間切れ=自分にダメージ。
//   3. 解説は勝利後にまとめて表示(学びの導線)。
//   4. どちらかの HP が 0 になるまで 1〜2 を繰り返す。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2, // 1/2(/3)の選択式。2 または 3。
    // プレイヤーの攻撃力(リズムクリア時に守備を引いてダメージ算出)
    PLAYER_ATTACK: 20,
    // リズムスコアによる追加ダメージ係数(score を 1200 で割った整数)
    SCORE_BONUS_DIVISOR: 1200,
    // 時間切れ(防御失敗)時に自分が受けるダメージ
    TIMEOUT_USES_ENEMY_ATTACK: true,
    TIMEOUT_FIXED_DAMAGE: 14,
  };

  async function run(core) {
    const learned = []; // 勝利後にまとめて表示する解説

    while (!core.isOver()) {
      // 1. クイズ(守備半減の判定)
      const quiz = window.QuizEngine.next(CONFIG.QUIZ_CHOICES);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);

      let effectiveDef = core.state.enemy.defense;
      if (ans.correct) {
        effectiveDef = Math.floor(core.state.enemy.defense / 2);
        core.log("正解! " + core.state.enemy.name + "の守備力が半減(" +
          core.state.enemy.defense + "→" + effectiveDef + ")", "good");
      } else {
        core.log("不正解... 守備力はそのまま(" + effectiveDef + ")", "bad");
      }

      if (core.isOver()) break;

      // 2. 防御リズム
      const rr = await core.runRhythmRound(
        "防御フェーズ: ［戦闘開始］を押してリズム。クリアで攻撃、時間切れで被弾"
      );
      if (rr.cleared) {
        const bonus = Math.floor(rr.score / CONFIG.SCORE_BONUS_DIVISOR);
        const dmg = Math.max(1, CONFIG.PLAYER_ATTACK + bonus - effectiveDef);
        core.damageEnemy(dmg);
        core.log("リズムクリア! " + core.state.enemy.name + "に " + dmg +
          " ダメージ (守備" + effectiveDef + " / ボーナス" + bonus + ")", "good");
      } else {
        const dmg = CONFIG.TIMEOUT_USES_ENEMY_ATTACK
          ? core.state.enemy.attack
          : CONFIG.TIMEOUT_FIXED_DAMAGE;
        core.damagePlayer(dmg);
        core.log("時間切れ... 自分に " + dmg + " ダメージ", "bad");
      }
    }

    // 3 & 4. 決着 + 解説まとめ
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
    core.log(outcome === "win" ? "そらドラゴンを撃破した!" : "力尽きてしまった...", "info");
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  window.BattleToshi = { run, CONFIG };
})();
