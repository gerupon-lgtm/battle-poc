// =====================================================
// battle-combo.js -- 連続バトル(攻防ノンストップ) 専用フロー＋軽量リズムエンジン
//   1セット = クイズ → [カウント-攻撃-カウント-防御] を「単一テンポの拍グリッド」で連続実行。
//   各カウント中にモード(攻撃/防御)のトーストを表示。停止・再開を挟まないためテンポが乱れない。
//   既存(weakpoint/たんたん/トシ)には一切手を加えず、battle-core.js を読み取り専用で再利用する。
//   ※会議前の検証PoC。攻撃=弱点マーカーを拍タップ／防御=落下ノーツをどこでもタップ(弱点案と同じ操作)。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2,
    BPM: 126,
    COUNT_BEATS: 4,      // 各カウントの拍数
    BARS_ATTACK: 4,      // 攻撃の小節数(×4拍)
    BARS_DEFENSE: 4,     // 防御の小節数(×4拍)
    LEAD_SEC: 0.7,       // タップ開始からカウント1拍目までの先行
    APPEAR_BEATS: 2,     // 落下ノーツの出現〜到達までの拍数
    // 判定窓(ms)
    PERFECT_MS: 80, GOOD_MS: 180,         // 防御
    ATK_PERFECT_MS: 50, ATK_GOOD_MS: 110, // 攻撃(厳しめ)
    // ダメージ(弱点案と同じモデル)
    ATTACK_MAX_PER_TURN: 25, GOOD_WEIGHT: 0.5, QUIZ_BUFF_MULT: 1.5,
    DEFENSE_MISS_DAMAGE: 8,
    HAPTIC_TAP: true,    // Android のみ(iOSは不可)
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- 音(メトロノーム) ----
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      audioCtx = new C();
    }
    return audioCtx;
  }
  function click(time, accent) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square";
    o.frequency.value = accent ? 1280 : 820;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.28 : 0.16, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(time); o.stop(time + 0.08);
  }

  // 既存エンジンのキャリブレーション値を流用(あれば)
  function calibOffsetMs() {
    try {
      const v = JSON.parse(localStorage.getItem("rhythmBattleTimingCalibration"));
      return v && typeof v.offsetMs === "number" ? v.offsetMs : 0;
    } catch (_) { return 0; }
  }

  function supportsVibration() {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }
  function hapticTap() {
    if (CONFIG.HAPTIC_TAP && supportsVibration()) { try { navigator.vibrate(12); } catch (_) {} }
  }

  function lane() { return document.getElementById("lane"); }

  function floatJudge(rank, text) {
    const L = lane(); if (!L) return;
    let jf = document.getElementById("bv-attack-judge");
    if (!jf) { jf = document.createElement("div"); jf.id = "bv-attack-judge"; jf.setAttribute("aria-hidden", "true"); L.appendChild(jf); }
    jf.className = rank; jf.textContent = text;
    void jf.offsetWidth; jf.classList.add("show");
  }

  // ---- 連続リズムブロック(1セット) ----
  // opts.visible: 弱点を可視化(クイズ正解)
  // 解決: { perfect, good, misses }
  function playBlock(core, opts) {
    return new Promise((resolve) => {
      const A = ensureAudio();
      const beatMs = 60000 / CONFIG.BPM;
      const cnt = CONFIG.COUNT_BEATS;
      const ba = CONFIG.BARS_ATTACK * 4;
      const bd = CONFIG.BARS_DEFENSE * 4;
      const atkStart = cnt, atkEnd = cnt + ba;
      const defCountStart = atkEnd, defStart = atkEnd + cnt, defEnd = defStart + bd;
      const total = defEnd;
      const L = lane();
      const notesEl = document.getElementById("notes");
      const hitLine = L ? L.querySelector(".hit-line") : null;
      const cin = document.getElementById("count-in");

      let marker = opts.marker || null;

      // 音は一括予約(短いので可)。映像は壁時計、入力も壁時計で判定(見た目と一致)。
      const startAudio = A.currentTime + CONFIG.LEAD_SEC;
      const startPerf = performance.now() + CONFIG.LEAD_SEC * 1000;
      for (let i = 0; i < total; i++) click(startAudio + i * (beatMs / 1000), i % 4 === 0);

      const tally = { perfect: 0, good: 0 };
      const usedAtk = new Set(), usedDef = new Set();
      const noteState = [];
      for (let j = defStart; j < defEnd; j++) noteState.push({ beat: j, el: null, spawned: false, hit: false, missed: false });
      let defHits = 0;

      // 攻撃カウントのトースト(ブロック開始時)
      if (core.toast) core.toast("攻撃ターン!", "attack");
      let defToastDone = false, weakHidden = false;

      function flashMarker(rank) {
        const m = document.getElementById("bv-weakpoint");
        if (m && m.classList.contains("visible")) { m.classList.add("hit-" + rank); setTimeout(() => m.classList.remove("hit-" + rank), 160); }
      }

      function judge(ev) {
        const t = (ev && ev.timeStamp) ? ev.timeStamp : performance.now();
        const songMs = t - startPerf - calibOffsetMs();
        const bi = Math.round(songMs / beatMs);
        const off = songMs - bi * beatMs;
        const a = Math.abs(off);
        if (bi >= atkStart && bi < atkEnd) {
          if (!marker) return;
          if (usedAtk.has(bi)) return;
          const lr = L.getBoundingClientRect();
          const mx = lr.width * marker.u, my = lr.height * marker.v;
          const within = Math.hypot((ev.clientX - lr.left) - mx, (ev.clientY - lr.top) - my) <= marker.rPx;
          if (!within) { floatJudge("miss", "位置×"); return; }
          if (a <= CONFIG.ATK_PERFECT_MS) { usedAtk.add(bi); tally.perfect++; flashMarker("perfect"); floatJudge("perfect", "PERFECT"); hapticTap(); }
          else if (a <= CONFIG.ATK_GOOD_MS) { usedAtk.add(bi); tally.good++; flashMarker("good"); floatJudge("good", "GOOD"); hapticTap(); }
          else { floatJudge("miss", "タイミング×"); }
          return;
        }
        if (bi >= defStart && bi < defEnd) {
          if (usedDef.has(bi)) return;
          if (a <= CONFIG.GOOD_MS) {
            usedDef.add(bi); defHits++;
            const n = noteState.find((x) => x.beat === bi);
            if (n) { n.hit = true; if (n.el) n.el.remove(); }
            floatJudge("good", "Block!"); hapticTap();
          }
          return;
        }
      }
      function laneTap(ev) { if (ev.cancelable) ev.preventDefault(); judge(ev); }
      if (L) L.addEventListener("pointerdown", laneTap);

      function spawnNote(n) {
        if (!notesEl || !hitLine) return;
        const hitY = hitLine.offsetTop;
        const el = document.createElement("div");
        el.className = "combo-note";
        el.style.left = (16 + Math.random() * 68) + "%";
        notesEl.appendChild(el);
        n.el = el;
        const remain = (startPerf + n.beat * beatMs) - performance.now();
        const dur = Math.max(40, remain);
        try {
          el.animate(
            [{ transform: "translateY(0)" }, { transform: "translateY(" + hitY + "px)" }],
            { duration: dur, fill: "forwards", easing: "linear" }
          );
        } catch (_) { el.style.transform = "translateY(" + hitY + "px)"; }
      }

      let raf = 0, lastBeat = -1;
      function frame() {
        const songMs = performance.now() - startPerf;
        const cur = songMs / beatMs;
        // カウント表示
        let label = "";
        if (cur < cnt) label = String(cnt - Math.floor(cur));
        else if (cur >= defCountStart && cur < defStart) label = String(cnt - Math.floor(cur - defCountStart));
        if (cin) { if (label) { cin.hidden = false; cin.textContent = label; } else { cin.hidden = true; } }
        // 防御カウントのトースト＋弱点を隠す
        if (!defToastDone && cur >= defCountStart) { defToastDone = true; if (core.toast) core.toast("防御ターン!", "defense"); }
        if (!weakHidden && cur >= defCountStart) { weakHidden = true; if (core.clearWeakpoint) core.clearWeakpoint(); }
        // 拍フラッシュ(テンポの視覚補助)
        const bnow = Math.floor(cur);
        if (bnow !== lastBeat && bnow >= 0 && bnow < total && hitLine) {
          lastBeat = bnow;
          hitLine.classList.add("combo-pulse");
          setTimeout(() => hitLine.classList.remove("combo-pulse"), 90);
        }
        // 防御ノーツ出現
        for (const n of noteState) {
          if (!n.spawned && songMs >= n.beat * beatMs - CONFIG.APPEAR_BEATS * beatMs) { n.spawned = true; spawnNote(n); }
          if (!n.hit && !n.missed && songMs > n.beat * beatMs + CONFIG.GOOD_MS) { n.missed = true; if (n.el) n.el.remove(); floatJudge("miss", "Damage!"); }
        }
        if (songMs >= total * beatMs + 280) { end(); return; }
        raf = requestAnimationFrame(frame);
      }
      function end() {
        cancelAnimationFrame(raf);
        if (L) L.removeEventListener("pointerdown", laneTap);
        noteState.forEach((n) => { if (n.el) n.el.remove(); });
        if (cin) cin.hidden = true;
        const misses = bd - defHits;
        resolve({ perfect: tally.perfect, good: tally.good, misses: misses });
      }
      raf = requestAnimationFrame(frame);
    });
  }

  // タップで開始(iOSの音声解錠は touchend/click のユーザー操作内で行う)
  function tapToStart(promptText) {
    return new Promise((resolve) => {
      const L = lane();
      const prompt = document.getElementById("bv-rhythm-prompt");
      if (prompt) prompt.textContent = "▶ 画面をタップして開始" + (promptText ? "（" + promptText + "）" : "");
      let invoked = false;
      const go = (e) => {
        if (invoked) return; invoked = true;
        if (e && e.cancelable) e.preventDefault();
        if (L) { L.removeEventListener("touchend", go); L.removeEventListener("click", go); L.style.cursor = ""; }
        const A = ensureAudio();
        if (A.state !== "running") { A.resume().then(resolve, resolve); } else { resolve(); }
      };
      if (L) { L.style.cursor = "pointer"; L.addEventListener("touchend", go); L.addEventListener("click", go); }
    });
  }

  function showNext(text) {
    return new Promise((resolve) => {
      const prompt = document.getElementById("bv-rhythm-prompt");
      if (prompt && text) prompt.textContent = text;
      const next = document.getElementById("bv-rhythm-next");
      if (!next) return resolve();
      next.classList.remove("hidden");
      next.onclick = () => { next.classList.add("hidden"); resolve(); };
    });
  }

  async function run(core) {
    const enemy = core.state.enemy;
    const learned = [];

    while (!core.isOver()) {
      // 1. クイズ
      if (core.toast) core.toast("はしけん出題！", "quiz");
      const quiz = window.QuizEngine.next(CONFIG.QUIZ_CHOICES);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);
      const buffed = ans.correct;
      core.log(buffed ? "正解! 弱点が可視化＋攻撃力アップ" : "不正解... 弱点は隠れたまま(手探り)", buffed ? "good" : "bad");

      // 2. 連続リズム(カウント-攻撃-カウント-防御)
      core.showStage("rhythm");
      const marker = await core.placeWeakpoint(!!buffed); // 攻撃の弱点＋敵画像を配置
      await tapToStart(buffed ? "攻撃→防御を連続" : "弱点は手探り。攻撃→防御を連続");
      const prompt = document.getElementById("bv-rhythm-prompt");
      if (prompt) prompt.textContent = "カウントに続いて 攻撃→防御 を演奏! (攻撃:光る弱点を拍タップ／防御:どこでもタップ)";
      const res = await playBlock(core, { visible: buffed, marker: marker });

      // 3. ダメージ集計
      const mult = buffed ? CONFIG.QUIZ_BUFF_MULT : 1;
      const totalBeats = CONFIG.BARS_ATTACK * 4;
      const frac = totalBeats > 0 ? (res.perfect + res.good * CONFIG.GOOD_WEIGHT) / totalBeats : 0;
      const dmg = Math.round(CONFIG.ATTACK_MAX_PER_TURN * frac * mult);
      if (dmg > 0) {
        core.damageEnemy(dmg);
        core.log("こうげき成功! " + enemy.name + "に " + dmg + " ダメージ (PERFECT" + res.perfect + "/GOOD" + res.good + (buffed ? " ×バフ" : "") + ")", "good");
      } else {
        core.log("弱点を捉えられなかった...", "bad");
      }
      if (!core.isOver()) {
        const d = res.misses * CONFIG.DEFENSE_MISS_DAMAGE;
        if (d > 0) { core.damagePlayer(d); core.log("こうげきをうけた! (Damage!) Miss" + res.misses + " → 自分に " + d + " ダメージ", "bad"); }
        else { core.log("こうげきをふせいだ! (Block!) ノーダメージ", "good"); }
      }
      if (core.clearWeakpoint) core.clearWeakpoint();
      if (core.isOver()) break;
      await showNext("結果: PERFECT" + res.perfect + "/GOOD" + res.good + " ｜ 被弾Miss" + res.misses + "  ［次へ］");
    }

    // 4. 決着＋解説
    const outcome = core.result();
    let html = "";
    if (outcome === "win") {
      html += '<p class="bv-finish-lead">出題された問題の解説</p>';
      learned.forEach((q, i) => {
        html += '<div class="bv-explain-item"><strong>Q' + (i + 1) + ". " +
          escapeHtml(q.question.replace(/\n/g, " ")) + "</strong><p>" + escapeHtml(q.explanation) + "</p></div>";
      });
    }
    core.showFinish(outcome, html);
    core.log(outcome === "win" ? enemy.name + "を撃破した!" : "力尽きてしまった...", "info");
  }

  window.BattleCombo = { run, CONFIG };
})();
