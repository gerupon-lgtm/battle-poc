// =====================================================
// battle-toshi.js  -- トシ案(改)
// リズムモードをページ上部で選択できる:
//   - "attack" 攻撃型(既定): クイズ正解=守備半減、リズムクリア=敵ダメージ /
//              時間切れ=自分ダメージ
//   - "defense" 防御専用    : リズムは自分の被ダメージのみに関与(獲得点数で軽減)。
//              敵へのダメージはクイズ正解で与える。
// 解説は勝利後にまとめて表示(学びの導線)。
// どちらかの HP が 0 になるまで繰り返す。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2, // 1/2(/3)の選択式。2 または 3。

    // --- 攻撃型(attack) ---
    PLAYER_ATTACK: 20, // リズムクリア時に守備を引いてダメージ算出
    SCORE_BONUS_DIVISOR: 1200, // リズムスコア → 追加ダメージ
    TIMEOUT_USES_ENEMY_ATTACK: true,
    TIMEOUT_FIXED_DAMAGE: 14,

    // --- 防御専用(defense) ---
    // クイズ正解で敵に与えるダメージ(敵の守備を引く)
    DEFENSE_QUIZ_ATTACK: 22,
    // 敵の反撃を、リズムスコアでどれだけ軽減できるか(score / 値 = 軽減点)
    DEFENSE_MITIGATION_DIVISOR: 800,
    // 防御クリア時の追加軽減(無傷になりやすくする)
    DEFENSE_CLEAR_BONUS: 6,
  };

  // mode: "attack" | "defense"
  async function run(core, opts) {
    opts = opts || {};
    const mode = opts.mode === "defense" ? "defense" : "attack";
    const learned = []; // 勝利後にまとめて表示する解説

    core.log(
      "リズムモード: " + (mode === "defense" ? "防御専用(被ダメージ軽減)" : "攻撃型"),
      "info"
    );

    while (!core.isOver()) {
      // 1. クイズ
      const quiz = window.QuizEngine.next(CONFIG.QUIZ_CHOICES);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);

      if (mode === "attack") {
        // 正解で守備半減 → 防御リズムで攻撃
        let effectiveDef = core.state.enemy.defense;
        if (ans.correct) {
          effectiveDef = Math.floor(core.state.enemy.defense / 2);
          core.log(
            "正解! " + core.state.enemy.name + "の守備力が半減(" +
              core.state.enemy.defense + "→" + effectiveDef + ")",
            "good"
          );
        } else {
          core.log("不正解... 守備力はそのまま(" + effectiveDef + ")", "bad");
        }
        if (core.isOver()) break;

        const rr = await core.runRhythmRound(
          "防御フェーズ: ［戦闘開始］を押してリズム。クリアで攻撃、時間切れで被弾"
        );
        if (rr.cleared) {
          const bonus = Math.floor(rr.score / CONFIG.SCORE_BONUS_DIVISOR);
          const dmg = Math.max(1, CONFIG.PLAYER_ATTACK + bonus - effectiveDef);
          core.damageEnemy(dmg);
          core.log(
            "リズムクリア! " + core.state.enemy.name + "に " + dmg +
              " ダメージ (守備" + effectiveDef + " / ボーナス" + bonus + ")",
            "good"
          );
        } else {
          const dmg = CONFIG.TIMEOUT_USES_ENEMY_ATTACK
            ? core.state.enemy.attack
            : CONFIG.TIMEOUT_FIXED_DAMAGE;
          core.damagePlayer(dmg);
          core.log("時間切れ... 自分に " + dmg + " ダメージ", "bad");
        }
      } else {
        // 防御専用: クイズ正解=敵にダメージ / リズム=自分の被ダメージを軽減
        if (ans.correct) {
          const dmg = Math.max(1, CONFIG.DEFENSE_QUIZ_ATTACK - core.state.enemy.defense);
          core.damageEnemy(dmg);
          core.log("正解! " + core.state.enemy.name + "に " + dmg + " ダメージ", "good");
        } else {
          core.log("不正解... 敵にダメージを与えられなかった", "bad");
        }
        if (core.isOver()) break;

        const rr = await core.runRhythmRound(
          "防御フェーズ(防御専用): ［戦闘開始］を押してリズム。スコアが高いほど被ダメージを軽減"
        );
        const base = core.state.enemy.attack;
        let mitigation = Math.floor(rr.score / CONFIG.DEFENSE_MITIGATION_DIVISOR);
        if (rr.cleared) mitigation += CONFIG.DEFENSE_CLEAR_BONUS;
        const dmg = Math.max(0, base - mitigation);
        if (dmg > 0) {
          core.damagePlayer(dmg);
          core.log(
            core.state.enemy.name + "の反撃! 自分に " + dmg +
              " ダメージ (反撃" + base + " - 軽減" + mitigation + ")",
            "bad"
          );
        } else {
          core.log(
            "完全防御! " + core.state.enemy.name + "の反撃を無効化(軽減" + mitigation + ")",
            "good"
          );
        }
      }
    }

    // 決着 + 解説まとめ(勝利時)
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
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.BattleToshi = { run, CONFIG };
})();
