// =====================================================
// battle-core.js
// 2案(たんたん案 / トシ案改)で共通のバトル基盤。
//   - プレイヤー/敵 HP の管理と描画
//   - コメント欄(ダメージ等)へのログ出力
//   - クイズパネルの描画と回答待ち
//   - リズムラウンドの実行(rhythm-battle-poc.js を流用)
// リズム部分のラウンド終了は window.RhythmBridge.onRoundEnd 経由で受け取る。
// =====================================================
(function () {
  const $ = (id) => document.getElementById(id);

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function create(opts) {
    const state = {
      enemy: opts.enemy,
      enemyMaxHp: opts.enemy.hp,
      enemyHp: opts.enemy.hp,
      playerMaxHp: opts.playerHp,
      playerHp: opts.playerHp,
      onLog: opts.onLog || function () {},
    };

    function renderHeader() {
      $("bv-enemy-img").src = state.enemy.image;
      $("bv-enemy-img").alt = state.enemy.name;
      $("bv-enemy-name").textContent = state.enemy.name;
      $("bv-enemy-hp").textContent = String(Math.max(0, state.enemyHp));
      $("bv-enemy-hp-max").textContent = String(state.enemyMaxHp);
      $("bv-enemy-hp-bar").style.width =
        clamp((state.enemyHp / state.enemyMaxHp) * 100, 0, 100) + "%";
      $("bv-player-hp").textContent = String(Math.max(0, state.playerHp));
      $("bv-player-hp-max").textContent = String(state.playerMaxHp);
      $("bv-player-hp-bar").style.width =
        clamp((state.playerHp / state.playerMaxHp) * 100, 0, 100) + "%";
    }

    function log(msg, kind) {
      const el = document.createElement("div");
      el.className = "bv-log-line" + (kind ? " " + kind : "");
      el.textContent = msg;
      const box = $("bv-log");
      box.prepend(el);
      state.onLog(msg, kind);
    }

    function damageEnemy(n) {
      state.enemyHp = Math.max(0, state.enemyHp - n);
      renderHeader();
    }
    function damagePlayer(n) {
      state.playerHp = Math.max(0, state.playerHp - n);
      renderHeader();
    }
    function isOver() {
      return state.enemyHp <= 0 || state.playerHp <= 0;
    }
    function result() {
      if (state.enemyHp <= 0) return "win";
      if (state.playerHp <= 0) return "lose";
      return null;
    }

    function showStage(which) {
      ["bv-quiz", "bv-rhythm", "bv-intro", "bv-finish"].forEach((id) => {
        $(id).classList.toggle("hidden", id !== "bv-" + which);
      });
    }

    // リズムラウンドを1回実行する。ユーザーがリズムパネル内の[戦闘開始]を
    // 押すと開始し、撃破 or 時間切れで {score, combo, cleared} を解決する。
    function runRhythmRound(prompt) {
      return new Promise((resolve) => {
        showStage("rhythm");
        $("bv-rhythm-prompt").textContent =
          prompt || "下の［戦闘開始］を押してリズムを開始してください";
        let done = false;
        window.RhythmBridge = {
          onRoundEnd: (r) => {
            if (done) return;
            done = true;
            window.RhythmBridge.onRoundEnd = null;
            resolve(r);
          },
        };
      });
    }

    // クイズを1問表示し、ユーザーの選択を待つ。
    // revealExplanation=true のとき、回答直後に解説を表示する(たんたん案)。
    // 解決値: { correct: bool, quiz }
    function showQuiz(quiz, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        showStage("quiz");
        $("bv-quiz-category").textContent = quiz.category || "";
        $("bv-quiz-q").textContent = quiz.question;
        $("bv-quiz-explain").classList.add("hidden");
        $("bv-quiz-explain").textContent = "";
        $("bv-quiz-next").classList.add("hidden");

        const wrap = $("bv-quiz-choices");
        wrap.innerHTML = "";
        quiz.choices.forEach((c) => {
          const btn = document.createElement("button");
          btn.className = "bv-choice";
          btn.textContent = c.text;
          btn.addEventListener("click", function onPick() {
            // 二重回答防止
            Array.from(wrap.children).forEach((b) => (b.disabled = true));
            if (c.correct) {
              btn.classList.add("correct");
            } else {
              btn.classList.add("wrong");
              // 正解も明示
              Array.from(wrap.children).forEach((b, i) => {
                if (quiz.choices[i].correct) b.classList.add("correct");
              });
            }
            const finish = () => resolve({ correct: !!c.correct, quiz });
            if (opts.revealExplanation) {
              $("bv-quiz-explain").textContent = quiz.explanation;
              $("bv-quiz-explain").classList.remove("hidden");
              $("bv-quiz-next").classList.remove("hidden");
              $("bv-quiz-next").onclick = finish;
            } else {
              // 解説は後で(トシ案)。少し見せてから次へ。
              $("bv-quiz-next").classList.remove("hidden");
              $("bv-quiz-next").onclick = finish;
            }
          });
          wrap.appendChild(btn);
        });
      });
    }

    function showFinish(outcome, extra) {
      showStage("finish");
      $("bv-finish-title").textContent = outcome === "win" ? "勝利!" : "敗北...";
      $("bv-finish-title").className =
        "bv-finish-title " + (outcome === "win" ? "win" : "lose");
      $("bv-finish-detail").innerHTML = extra || "";
    }

    renderHeader();
    return {
      state,
      renderHeader,
      log,
      damageEnemy,
      damagePlayer,
      isOver,
      result,
      showStage,
      runRhythmRound,
      showQuiz,
      showFinish,
    };
  }

  window.BattleCore = { create };
})();
