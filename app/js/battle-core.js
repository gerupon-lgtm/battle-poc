// =====================================================
// battle-core.js
// 2案(たんたん案 / トシ案改)で共通のバトル基盤。
//   - プレイヤー/敵 HP の管理と描画
//   - コメント欄(ダメージ等)へのログ出力
//   - クイズパネルの描画と回答待ち
//   - リズムラウンドの実行(rhythm-battle-poc.js を流用、曲はランダム/パターンは指定可)
//   - 敵ダメージの共通計算(絶対値基準±乱数 + かいしんのいちげき)
//   - タップパターンの進行管理
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
    // → HPが多い敵ほど撃破に多くのターンが必要になる。(旧baseRatioも後方互換)
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

  // リズムのタップパターンを設定する。
  //   patternId 指定時はそのパターン、null/未指定時はランダム。戻り値はラベル。
  function applyPattern(patternId) {
    const sel = $("pattern-select");
    if (!sel || !sel.options || !sel.options.length) return null;
    if (patternId) {
      sel.value = patternId;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === patternId) return sel.options[i].textContent || patternId;
      }
      return patternId;
    }
    const i = Math.floor(Math.random() * sel.options.length);
    sel.value = sel.options[i].value;
    return sel.options[i].textContent || sel.value;
  }

  // タップパターンの進行管理:
  //   基本→裏拍→技巧→余白→ブレイク技巧 の順。クリアで次へ進み、
  //   時間切れ(未クリア)なら同じパターンで再戦。ブレイク技巧クリア後はランダム。
  const PATTERN_ORDER = ["basic", "offbeat", "technical", "sparse", "jazzBreak"];
  // 弱点マーカーのヒット半径(px)。落下アイコン相当(約22px四方)に少し余裕。
  const WEAKPOINT_HIT_RADIUS_PX = 16;

  // リズムのレーン(#lane)の最背面に敵キャラ画像を敷く。
  // 落下物(.notes)はキャラの上、バー(.hit-line)・ゲージ(.beat-guide)は前面に重なる(CSSのz-index)。
  function setLaneEnemyBackground(imageUrl) {
    const lane = document.getElementById("lane");
    if (!lane) return;
    let bg = document.getElementById("bv-lane-enemy");
    if (!bg) {
      bg = document.createElement("div");
      bg.id = "bv-lane-enemy";
      bg.setAttribute("aria-hidden", "true");
      lane.insertBefore(bg, lane.firstChild); // 最背面へ
    }
    bg.style.backgroundImage = imageUrl ? 'url("' + imageUrl + '")' : "none";
  }

  function createPatternSequencer() {
    let idx = 0;
    let randomMode = false;
    return {
      next() {
        return randomMode ? null : PATTERN_ORDER[idx]; // null = ランダム
      },
      update(cleared) {
        if (randomMode) return;
        if (cleared) {
          idx += 1;
          if (idx >= PATTERN_ORDER.length) randomMode = true;
        }
        // 時間切れ(cleared=false)は idx 据え置き = 同じパターンで再戦
      },
    };
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
    // 開始前に曲をランダム選択(パターンは patternId 指定 or ランダム)し、
    // ユーザーが[戦闘開始]を押すと開始する。撃破 or 時間切れで結果を表示し、
    // ［次へ］を押してから {score, combo, cleared} を解決する(=次のターンへ進む)。
    function runRhythmRound(prompt, patternId) {
      return new Promise((resolve) => {
        showStage("rhythm");
        clearRhythmResult();
        setLaneEnemyBackground(state.enemy.image); // 背景に敵キャラ
        const songName = pickRandomSong(); // 曲は常にランダム
        const patName = applyPattern(patternId); // パターンは指定 or ランダム
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

    // 敵画像の不透過部分から弱点座標(レーン比 u,v)をランダムに選び、マーカーを配置する。
    // visible=true で薄く可視化、false で非表示(ヒット判定は有効)。Promiseで marker を解決。
    function placeWeakpoint(visible) {
      return new Promise((resolve) => {
        const lane = document.getElementById("lane");
        if (!lane) return resolve(null);
        let img = document.getElementById("bv-lane-enemy-img");
        if (!img) {
          img = document.createElement("img");
          img.id = "bv-lane-enemy-img";
          img.alt = "";
          img.setAttribute("aria-hidden", "true");
          lane.insertBefore(img, lane.firstChild);
        }
        const url = state.enemy.image;
        const finalize = (uv) => {
          img.src = url;
          const place = () => {
            const lr = lane.getBoundingClientRect();
            const ir = img.getBoundingClientRect();
            if (lr.width === 0 || ir.width === 0) { requestAnimationFrame(place); return; }
            const cx = (ir.left - lr.left) + uv[0] * ir.width;
            const cy = (ir.top - lr.top) + uv[1] * ir.height;
            const marker = { u: cx / lr.width, v: cy / lr.height, rPx: WEAKPOINT_HIT_RADIUS_PX };
            let m = document.getElementById("bv-weakpoint");
            if (!m) { m = document.createElement("div"); m.id = "bv-weakpoint"; m.setAttribute("aria-hidden", "true"); lane.appendChild(m); }
            m.style.left = (marker.u * 100) + "%";
            m.style.top = (marker.v * 100) + "%";
            m.className = visible ? "visible" : "";
            resolve(marker);
          };
          if (img.complete && img.naturalWidth) place(); else img.onload = place;
        };
        // α走査で不透過画素を選ぶ(同一オリジン画像のためcanvas可)。失敗時は中央寄り。
        const probe = new Image();
        probe.onload = () => {
          let uv = [0.5, 0.45];
          try {
            const nw = probe.naturalWidth, nh = probe.naturalHeight;
            const cv = document.createElement("canvas"); cv.width = nw; cv.height = nh;
            const ctx = cv.getContext("2d"); ctx.drawImage(probe, 0, 0);
            const data = ctx.getImageData(0, 0, nw, nh).data;
            const cand = [];
            const x0 = Math.floor(nw * 0.18), x1 = Math.ceil(nw * 0.82);
            const y0 = Math.floor(nh * 0.12), y1 = Math.ceil(nh * 0.78);
            const step = Math.max(1, Math.floor(Math.min(nw, nh) / 40));
            for (let y = y0; y < y1; y += step) {
              for (let x = x0; x < x1; x += step) {
                if (data[(y * nw + x) * 4 + 3] > 160) cand.push([x / nw, y / nh]);
              }
            }
            if (cand.length) uv = cand[Math.floor(Math.random() * cand.length)];
          } catch (e) { /* α取得不可→中央寄り */ }
          finalize(uv);
        };
        probe.onerror = () => finalize([0.5, 0.45]);
        probe.src = url;
      });
    }

    function clearWeakpoint() {
      const m = document.getElementById("bv-weakpoint");
      if (m) m.remove();
      const img = document.getElementById("bv-lane-enemy-img");
      if (img) img.remove();
    }

    // 攻撃ラウンド: 弱点マーカーを置き、拍タイミング×弱点位置の両方を満たすタップを集計する。
    // 解決値: { perfect, good, hits } と元のリズム結果 r。
    function runAttackRound(prompt, patternId, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        showStage("rhythm");
        clearRhythmResult();
        if (window.RhythmAttack && window.RhythmAttack.setMarkerMode) window.RhythmAttack.setMarkerMode(true);
        const lane = document.getElementById("lane");
        let marker = null;
        placeWeakpoint(!!opts.visible).then((m) => { marker = m; });
        const songName = pickRandomSong();
        const patName = applyPattern(patternId);
        const startBtn = $("start-btn");
        if (startBtn) startBtn.disabled = false;
        const base = prompt || "［戦闘開始］を押し、弱点を拍に合わせてタップ";
        const extra =
          (songName ? "（曲: " + songName : "") +
          (patName ? (songName ? " / タップ: " : "（タップ: ") + patName : "") +
          (songName || patName ? "）" : "");
        $("bv-rhythm-prompt").textContent = base + extra;

        const usedBeats = new Set();
        const tally = { perfect: 0, good: 0 };
        function flashMarker(rank) {
          const m = document.getElementById("bv-weakpoint");
          if (!m) return;
          m.classList.add("hit-" + rank);
          setTimeout(() => m.classList.remove("hit-" + rank), 160);
        }
        function onLaneTap(ev) {
          if (!marker) return;
          if (ev.cancelable) ev.preventDefault();
          const lr = lane.getBoundingClientRect();
          const mx = lr.width * marker.u, my = lr.height * marker.v;
          const tx = ev.clientX - lr.left, ty = ev.clientY - lr.top;
          if (Math.hypot(tx - mx, ty - my) > marker.rPx) return; // 弱点を外した
          const j = window.RhythmAttack ? window.RhythmAttack.judgeBeatTap(ev) : { valid: false };
          if (!j.valid || usedBeats.has(j.beatIndex)) return; // 1拍1回
          usedBeats.add(j.beatIndex);
          if (j.rank === "perfect") { tally.perfect += 1; flashMarker("perfect"); }
          else if (j.rank === "good") { tally.good += 1; flashMarker("good"); }
          else { flashMarker("miss"); }
        }
        lane.addEventListener("pointerdown", onLaneTap);

        let done = false;
        window.RhythmBridge = {
          onRoundEnd: (r) => {
            if (done) return;
            done = true;
            window.RhythmBridge.onRoundEnd = null;
            lane.removeEventListener("pointerdown", onLaneTap);
            if (window.RhythmAttack && window.RhythmAttack.setMarkerMode) window.RhythmAttack.setMarkerMode(false);
            if (startBtn) startBtn.disabled = true;
            const res = $("battle-result"); if (res) { res.hidden = true; res.className = "battle-result"; }
            $("bv-rhythm-prompt").textContent = "攻撃結果を確認して［次へ］を押してください";
            const next = $("bv-rhythm-next");
            next.classList.remove("hidden");
            next.onclick = () => {
              next.classList.add("hidden");
              clearWeakpoint();
              resolve({ perfect: tally.perfect, good: tally.good, hits: tally.perfect + tally.good, rhythm: r });
            };
          },
        };
      });
    }

    // クイズを1問表示し、ユーザーの選択を待つ。
    // revealExplanation=true のとき、回答直後に解説を表示する。
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
      runAttackRound,
      placeWeakpoint,
      clearWeakpoint,
      showQuiz,
      showFinish,
    };
  }

  window.BattleCore = { create, rollDamage, createPatternSequencer };
})();
