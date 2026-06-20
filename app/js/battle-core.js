// =====================================================
// battle-core.js
// 2案(たんたん案 / トシ案改)で共通のバトル基盤。
//   - プレイヤー/敵 HP の管理と描画
//   - コメント欄(ダメージ等)へのログ出力
//   - クイズパネルの描画と回答待ち
//   - リズムラウンドの実行(rhythm-battle-poc.js を流用、曲はランダム選択)
//   - 敵ダメージの共通計算(30%基準±乱数 + かいしんのいちげき)
// リズム部分のラウンド終了は window.RhythmBridge.onRoundEnd 経由で受け取る。
// =====================================================
(function () {
  const $ = (id) => document.getElementById(id);

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // 敵へのダメージ計算(共通)。
  //   通常: attackBase(絶対値) に ±randomRange の乱数(負数含む)を加算。HP依存しない。
  //   かいしんのいちげき: critChance の確率で、元最大HP × [critMinRatio, critMaxRatio] の大ダメージ。
  // 戻り値: { damage:Number, crit:Boolean }
  function rollDamage(maxHp, cfg) {
    cfg = cfg || {};
    const min = cfg.min != null ? cfg.min : 1;
    const critChance = cfg.critChance || 0;
    if (Math.random() < critChance) {
      const lo = cfg.critMinRatio != null ? cfg.critMinRatio : 0.7;
      const hi = cfg.critMaxRatio != null ? cfg.critMaxRatio : 0.9;
      const ratio = lo + Math.random() * (hi - lo);
      return { damage: Math.max(min, Math.round(maxHp * ratio)), crit: true };
    }
    // 通常ダメージは敵HPに依存しない絶対値基準(attackBase)。
    // → HPが多い敵ほど撃破に多くのターンが必要になる。
    // (旧baseRatio指定も後方互換として残す)
    const baseAbs =
      cfg.attackBase != null ? cfg.attackBase : maxHp * (cfg.baseRatio != null ? cfg.baseRatio : 0.3);
    const rnd = (Math.random() * 2 - 1) * (cfg.randomRange || 0);
    return { damage: Math.max(min, Math.round(baseAbs + rnd)), crit: false };
  }

  // リズムの曲をランダムに選ぶ(song-select の value を書き換える)
  function pickRandomSong() {
    const sel = $("song-select");
    if (sel && sel.options && sel.options.length) {
      const i = Math.floor(Math.random() * sel.options.length);
      sel.value = sel.options[i].value;
      return sel.options[i].textContent || sel.value;
    }
    return null;
  }

  // リズムのタップパターンをランダムに選ぶ(pattern-select の value を書き換える)
  function pickRandomPattern() {
    const sel = $("pattern-select");
    if (sel && sel.options && sel.options.length) {
      const i = Math.floor(Math.random() * sel.options.length);
      sel.value = sel.options[i].value;
      return sel.options[i].textContent || sel.value;
    }
    return null;
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
      $("bv-log").prepend(el);
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
      // モバイルのレイアウト切替用(リズム時に一画面へ収める)
      if (document.body) document.body.setAttribute("data-stage", which);
    }

    // 前ターンのリズム結果表示を消す
    function clearRhythmResult() {
      const res = $("battle-result");
      if (res) {
        res.hidden = true;
        res.className = "battle-result";
      }
      const next = $("bv-rhythm-next");
      if (next) next.classList.add("hidden");
    }

    // リズムラウンドを1回実行する。
    // 開始前に曲をランダム選択し、ユーザーが[戦闘開始]を押すと開始する。
    // 撃破 or 時間切れで結果を表示し、［次へ］を押してから
    // {score, combo, cleared} を解決する(=次のターンへ進む)。
    function runRhythmRound(prompt) {
      return new Promise((resolve) => {
        showStage("rhythm");
        clearRhythmResult();
        const songName = pickRandomSong(); // 曲をランダムに
        const patName = pickRandomPattern(); // タップパターンもランダムに
        const startBtn = $("start-btn");
        if (startBtn) startBtn.disabled = false;
        const base = prompt || "下の［戦闘開始］を押してリズムを開始してください";
        const extra =
          (songName ? "（曲: " + songName : "") +
          (patName ? (songName ? " / タップ: " : "（タップ: ") + patName : "") +
          (songName || patName ? "）" : "");
        $("bv-rhythm-prompt").textContent = base + extra;
        let done = false;
        window.RhythmBridge = {
          onRoundEnd: (r) => {
            if (done) return;
            done = true;
            window.RhythmBridge.onRoundEnd = null;
            if (startBtn) startBtn.disabled = true; // 再演奏を防止
            $("bv-rhythm-prompt").textContent =
              "リズム結果を確認して［次へ］を押してください";
            const next = $("bv-rhythm-next");
            next.classList.remove("hidden");
            next.onclick = () => {
              next.classList.add("hidden");
              resolve(r);
            };
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
            Array.from(wrap.children).forEach((b) => (b.disabled = true));
            if (c.correct) {
              btn.classList.add("correct");
            } else {
              btn.classList.add("wrong");
              Array.from(wrap.children).forEach((b, i) => {
                if (quiz.choices[i].correct) b.classList.add("correct");
              });
            }
            const finish = () => resolve({ correct: !!c.correct, quiz });
            if (opts.revealExplanation) {
              $("bv-quiz-explain").textContent = quiz.explanation;
              $("bv-quiz-explain").classList.remove("hidden");
            }
            $("bv-quiz-next").classList.remove("hidden");
            $("bv-quiz-next").onclick = finish;
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

  window.BattleCore = { create, rollDamage };
})();
