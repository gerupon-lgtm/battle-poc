// =====================================================
// battle-toshi.js  -- トシ案(改)
// リズムモードをページ上部で選択できる:
//   - "attack" 攻撃型(既定): クイズ正解=敵に直接ダメージ(元ターン制ロジック)。
//              リズムクリア=敵にダメージ / 時間切れ=自分にダメージ。
//   - "defense" 防御専用    : クイズ正解=敵に直接ダメージ(元ターン制ロジック)。
//              リズムは自分の被ダメージのみに関与(獲得点数で軽減)。
// クイズ正解時のダメージは、元の index.html / battle.js が持っていた
//   computeDamage = max(1, 攻撃力 - 相手守備力)  (オプションで±20%乱数)
// をそのまま流用する。守備半減ロジックは廃止(HP が本当に 0 にならない問題のため)。
// 解説は勝利後にまとめて表示。どちらかの HP が 0 になるまで繰り返す。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2, // 1/2(/3)の選択式。2 または 3。

    // --- 元ターン制バトルの攻撃ロジック(battle.js / config.js より) ---
    QUIZ_ATTACK_POWER: 15, // 元 CONFIG.PLAYER_ATTACK。クイズ正解時の攻撃力。
    BATTLE_USE_RANDOM: false, // true で ±RANGE の乱数(元の挙動)
    BATTLE_RANDOM_RANGE: 0.2,

    // --- 攻撃型(attack) リズム攻撃 ---
    RHYTHM_ATTACK_POWER: 20, // リズムクリア時の攻撃力
    SCORE_BONUS_DIVISOR: 1200, // リズムスコア → 追加ダメージ
    TIMEOUT_USES_ENEMY_ATTACK: true,
    TIMEOUT_FIXED_DAMAGE: 14,

    // --- 防御専用(defense) 被ダメージ軽減 ---
    DEFENSE_MITIGATION_DIVISOR: 800, // score / 値 = 軽減点
    DEFENSE_CLEAR_BONUS: 6, // 防御クリア時の追加軽減
  };

  // 元 battle.js の computeDamage をそのまま流用
  function computeDamage(attack, defense) {
    let base = Math.max(1, attack - defense);
    if (CONFIG.BATTLE_USE_RANDOM) {
      const r = 1 + (Math.random() * 2 - 1) * CONFIG.BATTLE_RANDOM_RANGE;
      base = Math.max(1, Math.round(base * r));
    }
    return base;
  }

  // mode: "attack" | "defense"
  async function run(core, opts) {
    opts = opts || {};
    const mode = opts.mode === "defense" ? "defense" : "attack";
    const enemy = core.state.enemy;
    const learned = []; // 勝利後にまとめて表示する解説

    core.log(
      "リズムモード: " + (mode === "defense" ? "防御専用(被ダメージ軽減)" : "攻撃型"),
      "info"
    );

    while (!core.isOver()) {
      // 1. クイズ: 正解で敵に直接ダメージ(元ターン制ロジック)
      const quiz = window.QuizEngine.next(CONFIG.QUIZ_CHOICES);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);

      if (ans.correct) {
        const dmg = computeDamage(CONFIG.QUIZ_ATTACK_POWER, enemy.defense);
        core.damageEnemy(dmg);
        core.log(
          "正解! " + enemy.name + "に " + dmg + " ダメージ" +
            "(攻撃" + CONFIG.QUIZ_ATTACK_POWER + " - 守備" + enemy.defense + ")",
          "good"
        );
      } else {
        core.log("不正解... 攻撃のチャンスを逃した", "bad");
      }
      if (core.isOver()) break;

      // 2. リズム
      if (mode === "attack") {
        const rr = await core.runRhythmRound(
          "防御フェーズ: ［戦闘開始］を押してリズム。クリアで攻撃、時間切れで被弾"
        );
        if (rr.cleared) {
          const bonus = Math.floor(rr.score / CONFIG.SCORE_BONUS_DIVISOR);
          const dmg = Math.max(1, CONFIG.RHYTHM_ATTACK_POWER + bonus - enemy.defense);
          core.damageEnemy(dmg);
          core.log(
            "リズムクリア! " + enemy.name + "に " + dmg +
              " ダメージ (攻撃" + CONFIG.RHYTHM_ATTACK_POWER + " / ボーナス" + bonus +
              " - 守備" + enemy.defense + ")",
            "good"
          );
        } else {
          const dmg = CONFIG.TIMEOUT_USES_ENEMY_ATTACK
            ? enemy.attack
            : CONFIG.TIMEOUT_FIXED_DAMAGE;
          core.damagePlayer(dmg);
          core.log("時間切れ... 自分に " + dmg + " ダメージ", "bad");
        }
      } else {
        // 防御専用: リズムは自分の被ダメージのみに関与(スコアで軽減)
        const rr = await core.runRhythmRound(
          "防御フェーズ(防御専用): ［戦闘開始］を押してリズム。スコアが高いほど被ダメージを軽減"
        );
        const base = enemy.attack;
        let mitigation = Math.floor(rr.score / CONFIG.DEFENSE_MITIGATION_DIVISOR);
        if (rr.cleared) mitigation += CONFIG.DEFENSE_CLEAR_BONUS;
        const dmg = Math.max(0, base - mitigation);
        if (dmg > 0) {
          core.damagePlayer(dmg);
          core.log(
            enemy.name + "の反撃! 自分に " + dmg +
              " ダメージ (反撃" + base + " - 軽減" + mitigation + ")",
            "bad"
          );
        } else {
          core.log(
            "完全防御! " + enemy.name + "の反撃を無効化(軽減" + mitigation + ")",
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
