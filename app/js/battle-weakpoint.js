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
    // 攻撃: 正規化方式 = 最大火力 × 成功割合 × バフ
    //   frac = (PERFECT×1 + GOOD×GOOD_WEIGHT) / 総拍数(4小節=16)
    //   dmg  = round(ATTACK_MAX_PER_TURN × frac × (正解?QUIZ_BUFF_MULT:1))
    // 小節数・判定窓を変えてもダメージが安定し、1ターン最大火力を先に決められる。
    ATTACK_MAX_PER_TURN: 25,    // 1ターンの基礎最大ダメージ(バフ無し・全PERFECT)
    GOOD_WEIGHT: 0.5,           // GOODの寄与(PERFECT=1.0基準)
    QUIZ_BUFF_MULT: 1.5,        // クイズ正解時の攻撃バフ
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
      const totalBeats = (window.RhythmAttack && window.RhythmAttack.getBars)
        ? window.RhythmAttack.getBars() * 4 : 16; // 4小節×4拍=総ノート(拍)数
      const frac = totalBeats > 0
        ? (atk.perfect + atk.good * CONFIG.GOOD_WEIGHT) / totalBeats : 0; // 成功割合 0〜1
      const dmg = Math.round(CONFIG.ATTACK_MAX_PER_TURN * frac * mult);
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
      // 弱点案の防御は時間切れの概念が無いため常にクリア扱い=タップパターンを順送りする
      patSeq.update(true);
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
