// =====================================================
// battle-combo.js -- 連続バトル(攻防ノンストップ) フロー【骨格段階】
//   コピーした実機エンジン(rhythm-combo-engine.js の window.ComboEngine)を使い、
//   カウント(攻撃2小節)→攻撃4小節→カウント(防御 可変小節)→防御4小節 を
//   単一テンポで途切れず演奏する。音/四分音符ゲージ/カウント/トーストを先に確認する。
//   ※入力判定・ダメージ・撃破鳴動は次段階で追加。既存(weakpoint等)には未介入。
//   HP/クイズ/結果/弱点配置/トーストは battle-core.js を読み取り専用で再利用。
// =====================================================
(function () {
  const CONFIG = {
    PLAYER_HP: 100,
    QUIZ_CHOICES: 2,
    BPM: 126,
    COUNT_ATTACK_BARS: 2,   // 攻撃カウント(二分1小節＋四分1小節)
    ATTACK_BARS: 4,
    COUNT_DEFENSE_BARS: 1,  // 防御カウント(四分1小節)。将来2小節へは数値変更だけでOK。
    DEFENSE_BARS: 4,
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

  // タップで開始(iOSの音声解錠は touchend/click のユーザー操作内で resume)
  function tapToStart() {
    return new Promise((resolve) => {
      const L = document.getElementById("lane");
      const p = document.getElementById("bv-rhythm-prompt");
      if (p) p.textContent = "▶ 画面をタップで開始（カウント→攻撃→カウント→防御 を連続演奏）";
      let done = false;
      const go = (e) => {
        if (done) return; done = true;
        if (e && e.cancelable) e.preventDefault();
        if (L) { L.removeEventListener("touchend", go); L.removeEventListener("click", go); L.style.cursor = ""; }
        const r = window.ComboEngine && window.ComboEngine.resume ? window.ComboEngine.resume() : Promise.resolve();
        Promise.resolve(r).then(resolve, resolve);
      };
      if (L) { L.style.cursor = "pointer"; L.addEventListener("touchend", go); L.addEventListener("click", go); }
    });
  }

  function playBlock(core) {
    return new Promise((resolve) => {
      window.ComboEngine.startCombo({
        songId: pickSong(),
        bpm: CONFIG.BPM,
        countAttackBars: CONFIG.COUNT_ATTACK_BARS,
        attackBars: CONFIG.ATTACK_BARS,
        countDefenseBars: CONFIG.COUNT_DEFENSE_BARS,
        defenseBars: CONFIG.DEFENSE_BARS,
        onPhase: (ph) => { if (core.toast) core.toast(ph === "attack" ? "攻撃ターン!" : "防御ターン!", ph); },
        onEnd: () => resolve(),
      });
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
      if (core.toast) core.toast("はしけん出題！", "quiz");
      const quiz = window.QuizEngine.next(CONFIG.QUIZ_CHOICES);
      const ans = await core.showQuiz(quiz, { revealExplanation: false });
      learned.push(quiz);
      core.log(ans.correct ? "正解! 弱点が可視化＋攻撃力アップ" : "不正解... 弱点は隠れたまま(手探り)", ans.correct ? "good" : "bad");

      core.showStage("rhythm");
      await core.placeWeakpoint(!!ans.correct); // 攻撃の弱点＋敵画像を配置(骨格では表示のみ)
      await tapToStart();
      const prompt = document.getElementById("bv-rhythm-prompt");
      if (prompt) prompt.textContent = "【骨格確認】テンポが途切れず流れるかを確認してください（入力判定は次段階）";
      await playBlock(core);
      if (core.clearWeakpoint) core.clearWeakpoint();
      // ※骨格段階: まだダメージ無し。次へ で次セットへ(終了はリロード)。
      await showNext("1セット終了（骨格）。［次へ］で次のクイズへ");
    }

    const outcome = core.result();
    core.showFinish(outcome, "");
  }

  window.BattleCombo = { run, CONFIG };
})();
