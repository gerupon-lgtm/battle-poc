// =====================================================
// battle-combo.js -- 連続バトル(攻防ノンストップ) フロー
//   コピーした実機エンジン(window.ComboEngine)で、カウント(攻撃2小節)→攻撃4小節→
//   カウント(防御 可変小節)→防御4小節 を単一テンポで連続演奏。攻撃=弱点マーカー拍タップ、
//   防御=落下ノーツ(パターン順送り)。撃破鳴動・連打ペナルティ・ガイド音・キャリブレーション・
//   ポーズを統合。HP/クイズ/結果/弱点配置/トーストは battle-core を読み取り専用で再利用。
//   ※既存(weakpoint/たんたん/トシ)には未介入。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2,
    QUIZ_DEFER_FEEDBACK: false, // true: 即時正誤表示を隠し、サーバ判定運用(回答送信→確定)を想定(Step5)
    AUTO_ADVANCE: true,         // true: セット間の「次へ」ボタンを省き、結果を短時間表示して自動で次のはしけんへ
    AUTO_ADVANCE_DELAY_MS: 700,  // 自動送り時に結果サマリーを見せる時間(ms)。0で即送り。
    BPM: 126,
    COUNT_ATTACK_BARS: 2,   // 攻撃カウント(二分1＋四分1)
    ATTACK_BARS: 4,
    COUNT_DEFENSE_BARS: 2,  // 防御カウント小節数(1 or 2)
    DEFENSE_BARS: 4,
    DIFFERENT_SONGS: false, // true で攻撃/防御を別曲(BPM共通=テンポは乱れない)
    GUIDE_SOUND: true,      // タップ位置を示すガイド音(ヒント音)。false で無音。
    NOTE_APPEAR_SEC: 1.5,   // 防御ノーツの落下時間(秒)。小さいほど速く・カウントと重なりにくい。
    APPROACH_BEATS: 1.5,    // 攻撃の接近リングが縮む拍数(予兆。小さいほど速い)。
    APPROACH_RING: true,    // 攻撃の接近リングを出すか(弱点可視時)。false で常に非表示。
    APPROACH_RING_COUNT: 1, // リングを出す拍数(最初の何拍ぶんか。1=一音目のみ)。
    // ダメージ
    ATTACK_MAX_PER_TURN: 25, GOOD_WEIGHT: 0.5, QUIZ_BUFF_MULT: 1.5,
    DEFENSE_MISS_DAMAGE: 8,
    // 連打抑止: ミスタップ時の入力ロック(ms)と小ペナルティ(自分への被ダメージ)
    LOCKOUT_MS: 300,
    PENALTY_DAMAGE: 2,
    // 弱点の当たり範囲(タップ許容半径px)。可視時=HIT_RADIUS_PX、非表示(手探り)時=×HIDDEN_RADIUS_MULT。
    HIT_RADIUS_PX: 30,
    HIDDEN_RADIUS_MULT: 2,
    // 振動(Androidのみ。iOSは不可)。タップ振動と拍振動を個別にON/OFF。
    HAPTIC_TAP: true,
    HAPTIC_BEAT: false,
    HAPTIC_TAP_MS: 12,
  };

  // 設定の保存/読込: ファイルの CONFIG をデフォルトとし、localStorage の保存値で上書きする。
  // 将来の設定画面はこのキーへ JSON を書き込めばよい(本体組込み時)。
  const CONFIG_STORE_KEY = "battleComboConfig";
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_STORE_KEY) || "{}");
    if (saved && typeof saved === "object") Object.assign(CONFIG, saved);
  } catch (_) { /* 壊れた保存値は無視 */ }
  window.BattleComboSettings = {
    get: function () { return Object.assign({}, CONFIG); },
    save: function (partial) {
      Object.assign(CONFIG, partial || {});
      try { localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(CONFIG)); } catch (_) {}
    },
    reset: function () { try { localStorage.removeItem(CONFIG_STORE_KEY); } catch (_) {} },
    KEY: CONFIG_STORE_KEY,
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function pickSong() {
    const sel = document.getElementById("song-select");
    if (sel && sel.options && sel.options.length) {
      const i = Math.floor(Math.random() * sel.options.length);
      sel.value = sel.options[i].value;
      return sel.value;
    }
    return "straight";
  }
  function isCalibratingNow() {
    return !!(window.RhythmAttack && window.RhythmAttack.isCalibrating && window.RhythmAttack.isCalibrating());
  }
  function calPanelOpen() {
    const p = document.getElementById("calibration-panel");
    return !!(p && !p.hidden);
  }

  // 画面下部(meter-card): コンボ/スコアを隠し、キャリブレーション/一時停止ボタンを配置。
  // レーン外なので誤タップしにくい。キャリブレーション中のレーンタップは記録へ回す。
  function setupControls(core) {
    const meter = document.querySelector(".meter-card");
    if (meter) {
      const combo = document.getElementById("combo");
      const score = document.getElementById("score");
      if (combo && combo.closest("div")) combo.closest("div").style.display = "none";
      if (score && score.closest("div")) score.closest("div").style.display = "none";
      const calBtn = document.getElementById("calibration-btn");
      if (calBtn) { calBtn.classList.add("bv-meter-btn"); meter.appendChild(calBtn); }
      if (!document.getElementById("bv-pause-btn")) {
        const pb = document.createElement("button");
        pb.id = "bv-pause-btn"; pb.type = "button"; pb.className = "bv-meter-btn bv-pause";
        pb.textContent = "⏸ 一時停止"; pb.disabled = true;
        pb.addEventListener("click", () => { if (window.ComboEngine && window.ComboEngine.requestPause) window.ComboEngine.requestPause(); });
        meter.appendChild(pb);
      }
    }
    // キャリブレーション中のレーンタップを記録へ回す(常設リスナー)
    const lane = document.getElementById("lane");
    if (lane && !lane._comboCalibWired) {
      lane._comboCalibWired = true;
      lane.addEventListener("pointerdown", (e) => {
        if (isCalibratingNow()) {
          if (e.cancelable) e.preventDefault();
          if (window.RhythmAttack && window.RhythmAttack.tapNote) window.RhythmAttack.tapNote(e);
        }
      });
    }
  }
  function setPlayUI(active) {
    const cal = document.getElementById("calibration-btn"); if (cal) cal.disabled = active;       // プレイ中は調整不可
    const pb = document.getElementById("bv-pause-btn"); if (pb) pb.disabled = !active;             // プレイ中のみ一時停止可
  }

  // タップで開始(iOSの音声解錠は touchend/click 内で resume)。調整中/完了表示中は開始しない。
  function tapToStart(buffed) {
    return new Promise((resolve) => {
      const L = document.getElementById("lane");
      const p = document.getElementById("bv-rhythm-prompt");
      if (p) p.textContent = "操作説明を読んでから、画面をタップで開始";
      // 大きく直感的な開始オーバーレイ(操作説明つき)。攻撃説明はクイズ正誤で切替。
      let ov = document.getElementById("bv-combo-start");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "bv-combo-start";
        ov.setAttribute("aria-hidden", "true");
        if (L) L.appendChild(ov); else document.body.appendChild(ov);
      }
      const atkTxt = buffed
        ? "<b>攻撃</b><br>拍（四分音符）に合わせて<br>光る弱点をタップ"
        : "<b>攻撃</b><br>弱点は隠れています<br>探して拍に合わせてタップ";
      ov.innerHTML =
        '<div class="cs-card">' +
        '<p class="cs-title">タップでスタート</p>' +
        '<div class="cs-row"><span class="cs-ico atk">🎯</span><span class="cs-txt">' + atkTxt + '</span></div>' +
        '<div class="cs-row"><span class="cs-ico def">🛡️</span><span class="cs-txt"><b>防御</b><br>落ちてくるノーツが<br>判定線に重なった瞬間にタップ</span></div>' +
        '<p class="cs-go">▶ 画面をタップして開始 ▶</p>' +
        '</div>';
      ov.hidden = false;
      let done = false;
      const go = (e) => {
        if (isCalibratingNow() || calPanelOpen()) return; // 調整中・完了表示中は開始しない
        if (done) return; done = true;
        if (e && e.cancelable) e.preventDefault();
        ov.hidden = true;
        if (L) { L.removeEventListener("touchend", go); L.removeEventListener("click", go); L.style.cursor = ""; }
        const r = window.ComboEngine && window.ComboEngine.resume ? window.ComboEngine.resume() : Promise.resolve();
        Promise.resolve(r).then(resolve, resolve);
      };
      if (L) { L.style.cursor = "pointer"; L.addEventListener("touchend", go); L.addEventListener("click", go); }
    });
  }

  function showNext(text) {
    return new Promise((resolve) => {
      const prompt = document.getElementById("bv-rhythm-prompt");
      if (prompt && text) prompt.textContent = text;
      const next = document.getElementById("bv-rhythm-next");
      // 自動送りモード: 「次へ」ボタンを出さず、結果を短時間見せてから自動で次へ。
      if (CONFIG.AUTO_ADVANCE) {
        if (next) next.classList.add("hidden");
        setTimeout(resolve, Math.max(0, CONFIG.AUTO_ADVANCE_DELAY_MS || 0));
        return;
      }
      if (!next) return resolve();
      next.classList.remove("hidden");
      next.onclick = () => { next.classList.add("hidden"); resolve(); };
    });
  }

  // 一時停止メニュー(battle-verify.css の #bv-pause-overlay を再利用)
  function showPauseMenu() {
    return new Promise((resolve) => {
      let ov = document.getElementById("bv-pause-overlay");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "bv-pause-overlay";
        ov.innerHTML =
          '<div class="bv-pause-box">' +
          '<p class="bv-pause-title">一時停止</p>' +
          '<button type="button" data-act="resume" class="bv-pause-opt">▶ 再開（このセットを最初から）</button>' +
          '<button type="button" data-act="restart" class="bv-pause-opt">↺ 直前のクイズから</button>' +
          '<button type="button" data-act="quit" class="bv-pause-opt danger">✕ やめる（戦闘開始前へ）</button>' +
          '</div>';
        document.body.appendChild(ov);
      }
      ov.hidden = false;
      const onClick = (e) => {
        const b = e.target.closest && e.target.closest("[data-act]");
        if (!b) return;
        ov.hidden = true;
        ov.removeEventListener("click", onClick);
        resolve(b.getAttribute("data-act"));
      };
      ov.addEventListener("click", onClick);
    });
  }

  function playBlock(core, opts) {
    return new Promise((resolve) => {
      const pick = opts.pickSong || pickSong;
      const atkSong = pick();
      const defSong = CONFIG.DIFFERENT_SONGS ? pick() : atkSong;
      window.ComboEngine.startCombo({
        attackSongId: atkSong,
        defenseSongId: defSong,
        bpm: CONFIG.BPM,
        countAttackBars: CONFIG.COUNT_ATTACK_BARS,
        attackBars: CONFIG.ATTACK_BARS,
        countDefenseBars: CONFIG.COUNT_DEFENSE_BARS,
        defenseBars: CONFIG.DEFENSE_BARS,
        defensePatternId: opts.defensePattern,
        marker: opts.marker,
        guideSound: CONFIG.GUIDE_SOUND,
        noteAppearSec: CONFIG.NOTE_APPEAR_SEC,
        approachBeats: CONFIG.APPROACH_BEATS,
        approachRing: CONFIG.APPROACH_RING,
        approachRingCount: CONFIG.APPROACH_RING_COUNT,
        hapticTap: CONFIG.HAPTIC_TAP,
        hapticBeat: CONFIG.HAPTIC_BEAT,
        hapticTapMs: CONFIG.HAPTIC_TAP_MS,
        lockoutMs: CONFIG.LOCKOUT_MS,
        onAttackHit: opts.onAttackHit,
        onDefenseMiss: opts.onDefenseMiss,
        onPenalty: opts.onPenalty,
        onPhase: (ph) => {
          if (core.toast) core.toast(ph === "attack" ? "攻撃ターン!" : "防御ターン!", ph);
          if (ph === "defense" && core.clearWeakpoint) core.clearWeakpoint();
        },
        onEnd: (res) => resolve(res || { perfect: 0, good: 0, defMisses: 0 }),
      });
    });
  }

  // Step5: combo専用のクイズ出題＋判定。battle-core(共有)は非改変のまま、
  //   判定(judge)を差し替え可能にし、選択ID(answerId)を捕捉する。
  //   judgeQuiz(quiz, pick) は { correct } を返す(Promise可)。既定はローカル即時判定。
  //   opts.hideFeedback=true で即時正誤表示を抑止(サーバ判定運用の想定)。
  //   返り値: Promise<{ correct, answerId, quiz }>
  function askQuiz(core, quiz, opts) {
    opts = opts || {};
    const judge = (typeof opts.judgeQuiz === "function")
      ? opts.judgeQuiz
      : function (q, pick) { return { correct: !!pick.correct }; };
    return new Promise(function (resolve) {
      if (core.showStage) core.showStage("quiz");
      const $ = function (id) { return document.getElementById(id); };
      $("bv-quiz-category").textContent = quiz.category || "";
      $("bv-quiz-q").textContent = quiz.question;
      $("bv-quiz-explain").classList.add("hidden");
      $("bv-quiz-explain").textContent = "";
      $("bv-quiz-next").classList.add("hidden");
      const wrap = $("bv-quiz-choices");
      wrap.innerHTML = "";
      quiz.choices.forEach(function (c, idx) {
        const btn = document.createElement("button");
        btn.className = "bv-choice";
        btn.textContent = c.text;
        btn.addEventListener("click", function onPick() {
          Array.from(wrap.children).forEach(function (b) { b.disabled = true; });
          const answerId = (c.id != null) ? c.id : idx; // Step5: 選択ID
          Promise.resolve(judge(quiz, { answerId: answerId, index: idx, correct: !!c.correct }))
            .then(function (v) { return v || { correct: !!c.correct }; }, function () { return { correct: !!c.correct }; })
            .then(function (verdict) {
              const correct = !!verdict.correct;
              if (!opts.hideFeedback) {
                if (correct) { btn.classList.add("correct"); }
                else {
                  btn.classList.add("wrong");
                  Array.from(wrap.children).forEach(function (b, i) {
                    if (quiz.choices[i].correct) b.classList.add("correct");
                  });
                }
              }
              if (opts.revealExplanation) {
                $("bv-quiz-explain").textContent = quiz.explanation;
                $("bv-quiz-explain").classList.remove("hidden");
              }
              $("bv-quiz-next").classList.remove("hidden");
              $("bv-quiz-next").onclick = function () { resolve({ correct: correct, answerId: answerId, quiz: quiz }); };
            });
        });
        wrap.appendChild(btn);
      });
    });
  }

  // データ注入の既定プロバイダ: 未指定時は従来どおりグローバル/DOMから供給する(挙動不変)。
  function defaultProviders() {
    return {
      getQuiz: function (n) { return window.QuizEngine.next(n); },
      pickSong: pickSong,
      patternSequencer: (window.BattleCore && window.BattleCore.createPatternSequencer)
        ? window.BattleCore.createPatternSequencer() : null,
      judgeQuiz: null, // Step5: 既定はローカル判定(askQuiz内)
    };
  }

  async function run(core, providers) {
    providers = providers || defaultProviders();
    if (!window.BattleRules) throw new Error("[combo] battle-rules.js が読み込まれていません(ダメージ計算式)");
    const enemy = core.state.enemy;
    const learned = [];
    const sets = [];                 // Step3: 構造化結果(セット毎の集計)
    const startedAt = Date.now();    // elapsedMs(経過時間)用
    const patSeq = providers.patternSequencer;
    setupControls(core);

    while (!core.isOver()) {
      if (core.toast) core.toast("クイズ出題！", "quiz");
      const quiz = providers.getQuiz(CONFIG.QUIZ_CHOICES);
      const ans = await askQuiz(core, quiz, {
        revealExplanation: false,
        hideFeedback: CONFIG.QUIZ_DEFER_FEEDBACK,
        judgeQuiz: providers.judgeQuiz,
      });
      learned.push(quiz);
      const buffed = ans.correct;
      core.log(buffed ? "正解! 弱点が可視化＋攻撃力アップ" : "不正解... 弱点は隠れたまま(手探り)", buffed ? "good" : "bad");

      core.showStage("rhythm");
      const hpSnap = { e: core.state.enemyHp, p: core.state.playerHp };
      const defPattern = patSeq.next();
      let restart = false, res = null, penaltyCount = 0;

      // セットのリズムブロック(ポーズ対応: 再開=このセットを最初から)
      while (true) {
        const marker = await core.placeWeakpoint(!!buffed);
        if (marker) marker.rPx = buffed ? CONFIG.HIT_RADIUS_PX : CONFIG.HIT_RADIUS_PX * CONFIG.HIDDEN_RADIUS_MULT;
        await tapToStart(buffed);
        const prompt = document.getElementById("bv-rhythm-prompt");
        if (prompt) prompt.textContent = "攻撃:光る弱点を拍タップ → 防御:落下ノーツをどこでもタップ（連続）";

        penaltyCount = 0;
        let atkApplied = 0, atkPerfect = 0, atkGood = 0;
        const rparams = window.BattleRules.paramsFromConfig(CONFIG); // 共有ルール(Step4)
        setPlayUI(true);
        res = await playBlock(core, {
          marker: marker, defensePattern: defPattern, pickSong: providers.pickSong,
          onAttackHit: (rank) => {
            if (rank === "perfect") atkPerfect++; else atkGood++;
            // 共有ルール式で累積目標を算出し、差分のみ適用(per-hit加算は従来と数値一致)。
            const target = window.BattleRules.computeAttackDamage(atkPerfect, atkGood, buffed, rparams);
            const add = target - atkApplied;
            if (add > 0) { core.damageEnemy(add); atkApplied += add; }
            const dead = core.state.enemyHp <= 0;
            if (dead && core.toast) core.toast("撃破！", "attack");
            return dead;
          },
          onDefenseMiss: () => {
            core.damagePlayer(CONFIG.DEFENSE_MISS_DAMAGE);
            const dead = core.state.playerHp <= 0;
            if (dead && core.toast) core.toast("ダウン…", "defense");
            return dead;
          },
          onPenalty: () => {
            penaltyCount++;
            core.damagePlayer(CONFIG.PENALTY_DAMAGE);
            const dead = core.state.playerHp <= 0;
            if (dead && core.toast) core.toast("ダウン…", "defense");
            return dead;
          },
        });
        setPlayUI(false);
        res._atkApplied = atkApplied;

        if (res.paused) {
          const act = await showPauseMenu();
          // 中断したブロックの途中ダメージは取り消し
          core.state.enemyHp = hpSnap.e; core.state.playerHp = hpSnap.p; if (core.renderHeader) core.renderHeader();
          if (core.clearWeakpoint) core.clearWeakpoint();
          if (act === "resume") { continue; }           // このセットを最初から
          if (act === "quit") { location.reload(); return; }
          restart = true; break;                          // 直前のクイズから
        }
        break;
      }

      if (restart) continue; // 直前のクイズへ

      sets.push({
        quizId: quiz.id,
        quizAnswerId: ans.answerId,     // Step5: 選択ID
        quizCorrect: !!buffed,
        atk: { perfect: res.perfect || 0, good: res.good || 0 },
        defMisses: res.defMisses || 0,
        penalties: penaltyCount,
        damageDealt: hpSnap.e - core.state.enemyHp,   // このセットで敵に与えた量
        damageTaken: hpSnap.p - core.state.playerHp,  // このセットで受けた量
      });

      patSeq.update(true);
      const atkApplied = res._atkApplied || 0;
      if (atkApplied > 0) core.log("こうげき! " + enemy.name + "に 計" + atkApplied + " ダメージ (PERFECT" + res.perfect + "/GOOD" + res.good + (buffed ? " ×バフ" : "") + ")", "good");
      else core.log("弱点を捉えられなかった...", "bad");
      if (res.defMisses > 0) core.log("防御: 被弾Miss" + res.defMisses + " → 計" + (res.defMisses * CONFIG.DEFENSE_MISS_DAMAGE) + "ダメージ", "bad");
      else core.log("防御成功! (Block!) ノーダメージ", "good");
      if (core.clearWeakpoint) core.clearWeakpoint();
      if (core.isOver()) break;
      await showNext("1セット終了｜PERFECT" + res.perfect + "/GOOD" + res.good + " 被弾Miss" + res.defMisses + "  ［次へ］");
    }

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

    // Step3: 構造化結果(onResult/将来のサーバ送信の素材)。
    //   answerIdの厳密化はStep5、ダメージ上限の再計算/検証はStep4で扱う。
    const sum = function (f) { return sets.reduce(function (a, s) { return a + f(s); }, 0); };
    return {
      outcome: outcome,
      elapsedMs: Date.now() - startedAt,
      sets: sets,
      totals: {
        perfect: sum(function (s) { return s.atk.perfect; }),
        good: sum(function (s) { return s.atk.good; }),
        defMisses: sum(function (s) { return s.defMisses; }),
        penalties: sum(function (s) { return s.penalties; }),
        damageDealt: sum(function (s) { return s.damageDealt; }),
        damageTaken: sum(function (s) { return s.damageTaken; }),
      },
    };
  }


  // =====================================================
  // DOM契約: combo が動作するために必要な要素(本体組込み時の最低要件)。
  //   ここに無い要素(例: #song-select)は任意。欠落時は start() がエラーにして
  //   原因を明示する(本体側でDOMを用意し損ねた場合の早期検知)。
  //   ※ run() を直接呼ぶ既存/テスト経路はこの検査を通らない(後方互換のため)。
  // =====================================================
  const REQUIRED_DOM_IDS = [
    "lane",            // リズムレーン(エンジンの描画・タップ受け口)
    "notes",           // 落下ノーツ格納
    "count-in",        // カウント表示
    "beat-guide",      // 拍ガイド
    "bv-rhythm-prompt",// 操作プロンプト
    "bv-rhythm-next",  // セット間「次へ」
    "calibration-btn", // タイミング調整
    "bv-quiz-category","bv-quiz-q","bv-quiz-choices","bv-quiz-explain","bv-quiz-next", // クイズ(Step5: askQuiz)
  ];
  const REQUIRED_DOM_SELECTORS = [
    ".hit-line",       // 判定ライン
    ".meter-card",     // 下部メータ(調整/一時停止ボタンの置き場)
  ];
  function checkDomContract(root) {
    const doc = root || document;
    const missing = [];
    REQUIRED_DOM_IDS.forEach(function (id) { if (!doc.getElementById(id)) missing.push("#" + id); });
    REQUIRED_DOM_SELECTORS.forEach(function (sel) { if (!doc.querySelector(sel)) missing.push(sel); });
    return missing;
  }

  // =====================================================
  // 単一エントリ: combo バトルの開始口を一本化する(本体組込みの足場)。
  //   現状は combo.html のインライン bootstrap(warmup→core生成→run)を集約しただけで、
  //   挙動は不変。データ注入(enemy/quiz/song)や構造化結果(onResult)は後続Stepで拡張。
  //   opts:
  //     { core }              : 既存の BattleCore インスタンスをそのまま使う場合
  //     { enemy, playerHp }   : core を内部生成する場合(既定 playerHp=CONFIG.PLAYER_HP)
  //     { root }              : DOM探索のルート(既定 document)
  //     { onResult(summary) } : 終了時コールバック(構造化結果。Step3)
  //     { onError(err) }      : 前提不備時のコールバック
  //   戻り値: Promise<core>
  // =====================================================
  function start(opts) {
    opts = opts || {};
    if (typeof opts.autoAdvance === "boolean") CONFIG.AUTO_ADVANCE = opts.autoAdvance; // モード選択(セット間の自動送り)
    const root = opts.root || document;
    const missing = checkDomContract(root);
    if (missing.length) {
      const err = new Error("[combo] 必要なDOM要素が不足しています: " + missing.join(", "));
      if (typeof console !== "undefined") console.error(err.message);
      if (opts.onError) { try { opts.onError(err); } catch (_) {} }
      return Promise.reject(err);
    }
    // 音声の早期解錠・安定化(ユーザー操作内で呼ばれる前提)。
    if (window.ComboEngine && window.ComboEngine.warmup) { try { window.ComboEngine.warmup(); } catch (_) {} }

    let core = opts.core;
    if (!core) {
      if (!window.BattleCore || !window.BattleCore.create) {
        const err = new Error("[combo] BattleCore.create が見つかりません(core を渡してください)");
        if (opts.onError) { try { opts.onError(err); } catch (_) {} }
        return Promise.reject(err);
      }
      core = window.BattleCore.create({
        enemy: opts.enemy,
        playerHp: opts.playerHp != null ? opts.playerHp : CONFIG.PLAYER_HP,
      });
    }

    // データ注入: opts で指定があればそれを、無ければ既定(グローバル/DOM)を使う。
    const providers = {
      getQuiz: (typeof opts.getQuiz === "function") ? opts.getQuiz
        : function (n) { return window.QuizEngine.next(n); },
      pickSong: (typeof opts.pickSong === "function") ? opts.pickSong : pickSong,
      patternSequencer: (opts.patternSequencer && typeof opts.patternSequencer.next === "function")
        ? opts.patternSequencer
        : ((window.BattleCore && window.BattleCore.createPatternSequencer)
            ? window.BattleCore.createPatternSequencer() : null),
      judgeQuiz: (typeof opts.judgeQuiz === "function") ? opts.judgeQuiz : null, // Step5: クイズ判定(既定=ローカル)
    };
    const p = run(core, providers);
    if (opts.onResult) {
      p.then(function (result) {
        try { opts.onResult(result || { outcome: core.result ? core.result() : null }); } catch (_) {}
      });
    }
    return p.then(function () { return core; });
  }

  // 単一エントリ(ComboBattle.start)を正とする。run/CONFIG は後方互換・テスト用に維持。
  window.ComboBattle = { start: start, run: run, CONFIG: CONFIG, checkDomContract: checkDomContract };
  window.BattleCombo = window.ComboBattle; // 既存参照(window.BattleCombo)の後方互換エイリアス
})();
