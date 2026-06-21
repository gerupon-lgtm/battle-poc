// =====================================================
// battle-weakpoint.js  -- 弱点ねらい案(ランダムマーカー / docs13 §16 モードC, 50_design §2)
// 戦闘の流れ(毎サイクル):
//   1. クイズ出題。正解=後続の攻撃で弱点を可視化＋攻撃力バフ／不正解=弱点は隠す(手探り)
//   2〜3. 攻撃ターン: 敵画像の不透過部分にランダムな弱点(攻撃中は固定)。拍に合わせて
//         弱点をタップ(時間×空間の両判定)。判定は防御より厳しめ。ヒットで敵にダメージ。
//   4. 防御ターン: 従来リズム。Perfect/Good=防御成功(無傷)、Miss=被弾。
//   5. どちらかの HP が 0 になるまで 1〜4 を繰り返す。
//   6. 結果＋解説(勝利時にまとめて)。
// ※会議前の検証PoC(合意仕様ではない / 50_design §2 のたんたん提案を具体化)。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2,
    // 攻撃: 弱点ミート1回あたりのダメージ(ラウンド合計をCAPで上限)
    ATTACK_PERFECT_DAMAGE: 2,
    ATTACK_GOOD_DAMAGE: 1,
    QUIZ_BUFF_MULT: 1.5,        // クイズ正解時の攻撃バフ
    ATTACK_ROUND_CAP: 40,       // 1攻撃ターンの最大ダメージ
    // 防御: Miss1回あたりの被ダメージ
    DEFENSE_MISS_DAMAGE: 8,
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function run(core) {
    const enemy = core.state.enemy;
    const learned = [];
    const patSeq = window.BattleCore.createPatternSequencer();
    // 弱点案は短めの4小節で1ターンとする(エンジンは各ページ独立インスタンスのため他案に影響なし)
    if (window.RhythmAttack && window.RhythmAttack.setBars) window.RhythmAttack.setBars(4);

    while (!core.isOver()) {
      // 1. クイズ(毎サイクル)。正解で弱点可視化＋攻撃バフ。
      if (core.toast) core.toast("はしけん出題！", "quiz");
      const quiz = window.QuizEngine.next(CONFIG.QUIZ_CHOICES);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);
      const buffed = ans.correct;
      core.log(
        buffed ? "正解! 弱点が可視化＋攻撃力アップ" : "不正解... 弱点は隠れたまま(手探り)",
        buffed ? "good" : "bad"
      );

      // 2〜3. 攻撃ターン(弱点ねらい)
      const atk = await core.runAttackRound(
        buffed
          ? "攻撃: 光る弱点を拍に合わせてタップ!"
          : "攻撃: 弱点は非表示。位置を探して拍に合わせてタップ",
        null,
        { visible: buffed, turnLabel: "攻撃ターン" }
      );
      const mult = buffed ? CONFIG.QUIZ_BUFF_MULT : 1;
      const raw = atk.perfect * CONFIG.ATTACK_PERFECT_DAMAGE + atk.good * CONFIG.ATTACK_GOOD_DAMAGE;
      const dmg = Math.min(Math.round(raw * mult), CONFIG.ATTACK_ROUND_CAP);
      if (dmg > 0) {
        core.damageEnemy(dmg);
        core.log(
          "こうげき成功! " + enemy.name + "に " + dmg + " ダメージ" +
            " (PERFECT" + atk.perfect + "/GOOD" + atk.good + (buffed ? " ×バフ" : "") + ")",
          "good"
        );
      } else {
        core.log("弱点を捉えられなかった...", "bad");
      }
      if (core.isOver()) break;

      // 4. 防御ターン(従来リズム)。Miss で被弾。
      const def = await core.runRhythmRound(
        "防御: 画面のどこでもタップで受ける(Perfect/Good=防御, Miss=被弾)",
        patSeq.next(),
        { phase: "defense", skipEnemyBg: true, tapToStart: true, tapAnywhere: true, turnLabel: "防御ターン" }
      );
      patSeq.update(def.cleared);
      const misses = def.misses || 0;
      if (misses > 0) {
        const d = misses * CONFIG.DEFENSE_MISS_DAMAGE;
        core.damagePlayer(d);
        core.log("こうげきをうけた! (Damage!) Miss" + misses + " → 自分に " + d + " ダメージ", "bad");
      } else {
        core.log("こうげきをふせいだ! (Block!) ノーダメージ", "good");
      }
    }

    // 6. 決着 + 解説まとめ(勝利時)
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

  window.BattleWeakpoint = { run, CONFIG };
})();
