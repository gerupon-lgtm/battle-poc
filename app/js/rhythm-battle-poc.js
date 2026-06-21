(function () {
  "use strict";

  const SETTINGS = {
    bpm: 126,
    bars: 8,
    lookAheadSec: 2.1,
    perfectMs: 80,
    goodMs: 180,
    clearHpRatio: 0.7,
    calibrationVersion: 1,
    // 判定線(バー)のフラッシュ: true=譜面のタップ時刻(note.time)に同期 / false=従来の4分音符ごと
    // 従来挙動へ戻す場合は false、または URL に ?hitline=beats を付ける。
    hitLineFlashByNotes: true,
    // 演奏中に「音声↔壁時計」の対応を測り直し、振動アンカーを音声へ追従させる(音とのズレ低減)。
    // ?resync=off で無効化(従来=開始時アンカー固定)。
    hapticResyncEnabled: true,
    // 「戦闘開始」押下からカウント1拍目までの待ち(秒)。
    // 開始直後は合成アニメ生成等で主スレッドが混むため、余裕を持たせて
    // カウント拍と振動が詰まって発火する違和感を避ける。
    startLeadSec: 0.5,
    // 弱点ねらい(マーカー攻撃)モード。true で落下ノーツを出さず、拍タップを外部(フロー)で判定。
    markerAttackMode: false,
    // 攻撃の拍タップ判定窓(防御の PERFECT ±80 / GOOD ±180 より厳しめ)。
    attackPerfectMs: 50,
    attackGoodMs: 110,
  };

  const CALIBRATION_STORAGE_KEY = "rhythmBattleTimingCalibration";
  const BASS_FILTER_FREQUENCY = 700;

  const SONG_DEFINITIONS = Object.freeze({
    straight: Object.freeze({
      label: "ストレート・バトル",
      groove: "straight",
      bass: Object.freeze([98, 123.47, 110, 146.83]),
    }),
    syncopated: Object.freeze({
      label: "シンコペーション・ドライブ",
      groove: "straight",
      bass: Object.freeze([110, 146.83, 130.81, 164.81]),
    }),
    shuffle: Object.freeze({
      label: "シャッフル・クエスト",
      groove: "shuffle",
      bass: Object.freeze([82.41, 110, 98, 123.47]),
    }),
    minimal: Object.freeze({
      label: "余白のステップ",
      groove: "straight",
      bass: Object.freeze([73.42, 98, 82.41, 110]),
    }),
    jazz: Object.freeze({
      label: "ミッドナイト・ブレイク（JAZZ）",
      groove: "shuffle",
      bass: Object.freeze([87.31, 116.54, 98, 130.81]),
    }),
  });

  const CHART_DEFINITIONS = Object.freeze({
    basic: Object.freeze({
      label: "基本",
      beats: Object.freeze([0, 1, 2, 3]),
    }),
    offbeat: Object.freeze({
      label: "裏拍",
      beats: Object.freeze([0.5, 1.5, 2.5, 3.5]),
    }),
    technical: Object.freeze({
      label: "技巧",
      beats: Object.freeze([0, 0.5, 1.5, 2, 2.5, 3.5]),
    }),
    sparse: Object.freeze({
      label: "余白",
      beats: Object.freeze([0, 2.5]),
    }),
    jazzBreak: Object.freeze({
      label: "ブレイク技巧",
      barBeats: Object.freeze([
        Object.freeze([0, 0.5, 1, 1.5, 2.5, 3.5]),
        Object.freeze([0, 0.5, 1.5, 2, 2.5, 3.5]),
        Object.freeze([0, 0.5, 1.5, 2, 3.5]),
        Object.freeze([0, 0.5, 1.5, 2.5, 3.5]),
        Object.freeze([]),
        Object.freeze([]),
        Object.freeze([2.5, 3.5]),
        Object.freeze([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]),
      ]),
    }),
  });

  const JAZZ_TURNAROUND = Object.freeze([
    Object.freeze({ name: "Dm7", bassRoot: 73.42, chordRoot: 146.83, intervals: Object.freeze([0, 3, 7, 10]) }),
    Object.freeze({ name: "G7", bassRoot: 98, chordRoot: 196, intervals: Object.freeze([0, 4, 7, 10]) }),
    Object.freeze({ name: "Cmaj7", bassRoot: 65.41, chordRoot: 130.81, intervals: Object.freeze([0, 4, 7, 11]) }),
    Object.freeze({ name: "A7(b9)", bassRoot: 55, chordRoot: 110, intervals: Object.freeze([0, 4, 7, 10, 13]) }),
  ]);

  const JAZZ_RUNNING_BASS = Object.freeze([
    Object.freeze([0, 3, 7, 6]),
    Object.freeze([0, 4, 7, 6]),
    Object.freeze([0, 4, 7, 10]),
    Object.freeze([0, 4, 7, 4]),
    Object.freeze([12, 10, 7, 6]),
    Object.freeze([12, 10, 7, 6]),
    Object.freeze([12, 11, 7, 10]),
    Object.freeze([12, 10, 7, 4]),
  ]);

  const JAZZ_PIANO_VOICINGS = Object.freeze([
    Object.freeze({ name: "Dm7", chordRoot: 146.83, intervals: Object.freeze([0, 3, 7, 10]) }),
    Object.freeze({ name: "G7", chordRoot: 196, intervals: Object.freeze([-8, -2, 0, 7]) }),
    Object.freeze({ name: "Cmaj7", chordRoot: 130.81, intervals: Object.freeze([0, 4, 7, 11]) }),
    Object.freeze({ name: "A7(b9)", chordRoot: 110, intervals: Object.freeze([0, 4, 10, 13]) }),
    Object.freeze({ name: "Dm7", chordRoot: 146.83, intervals: Object.freeze([-2, 0, 3, 7]) }),
    Object.freeze({ name: "G7", chordRoot: 196, intervals: Object.freeze([-8, -5, -2, 0]) }),
    Object.freeze({ name: "Cmaj7", chordRoot: 130.81, intervals: Object.freeze([4, 7, 11, 12]) }),
    Object.freeze({ name: "A7(b9)", chordRoot: 110, intervals: Object.freeze([4, 7, 10, 13]) }),
  ]);

  function beatSeconds(bpm) {
    return 60 / bpm;
  }

  function songBeatCount(bars, beatsPerBar) {
    return bars * beatsPerBar;
  }

  function songDurationSeconds(bpm, bars, beatsPerBar) {
    return songBeatCount(bars, beatsPerBar) * beatSeconds(bpm);
  }

  function shouldScheduleBeat(index, bars, beatsPerBar) {
    return index >= 0 && index < songBeatCount(bars, beatsPerBar);
  }

  // 撃破時の鳴動(リングアウト)終了拍を求める。
  // 少なくとも撃破した拍の小節末まで鳴らし、4拍目(小節最終拍)での撃破は次の1小節も鳴らす。
  // 戻り値は曲頭からの通算拍(曲末でキャップ)。
  function defeatRingOutBeat(hitSongTime, bpm, bars, beatsPerBar = 4) {
    const beat = beatSeconds(bpm);
    const beatPos = hitSongTime / beat + 1e-6; // 4拍ちょうどの浮動小数点誤差対策
    const barIndex = Math.floor(beatPos / beatsPerBar);
    const beatInBar = ((Math.floor(beatPos) % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const extraBars = beatInBar === beatsPerBar - 1 ? 2 : 1;
    return Math.min((barIndex + extraBars) * beatsPerBar, songBeatCount(bars, beatsPerBar));
  }

  function stopTrackedSources(sources) {
    let stopped = 0;
    for (const source of sources) {
      try {
        source.stop();
        stopped += 1;
      } catch (_) {
        // AudioScheduledSourceNode throws if it has already stopped.
      }
    }
    sources.clear();
    return stopped;
  }

  function normalizeBpm(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function countInDuration(bpm, beats) {
    return beatSeconds(bpm) * beats;
  }

  function calculateSongStartTime(countInStartTime, bpm, beats) {
    return countInStartTime + countInDuration(bpm, beats);
  }

  function buildCountInEvents() {
    return [
      { beatOffset: 0, label: 1, guideIndex: 0 },
      { beatOffset: 2, label: 2, guideIndex: 2 },
      { beatOffset: 4, label: 1, guideIndex: 0 },
      { beatOffset: 5, label: 2, guideIndex: 1 },
      { beatOffset: 6, label: 3, guideIndex: 2 },
      { beatOffset: 7, label: 4, guideIndex: 3 },
    ];
  }

  function supportsVibration(navigatorObject) {
    return Boolean(navigatorObject && typeof navigatorObject.vibrate === "function");
  }

  function calculateHapticDelayMs(targetAudioTime, currentAudioTime, maxLateMs = 80) {
    const deltaMs = (targetAudioTime - currentAudioTime) * 1000;
    if (!Number.isFinite(deltaMs) || deltaMs < -maxLateMs) return null;
    return Math.max(0, Math.round(deltaMs * 1000) / 1000);
  }

  function calculateVisualBeatState(songTime, bpm, beatsPerBar = 4, pulseSeconds = 0.12) {
    if (!Number.isFinite(songTime) || songTime < 0) {
      return { beatIndex: -1, progress: 0, pulse: false };
    }
    const beat = beatSeconds(bpm);
    const elapsedBeats = songTime / beat;
    const wholeBeats = Math.floor(elapsedBeats);
    const progress = elapsedBeats - wholeBeats;
    return {
      beatIndex: wholeBeats % beatsPerBar,
      progress,
      pulse: progress * beat < pulseSeconds,
    };
  }

  function isDebugMode(search) {
    return new URLSearchParams(search || "").get("debug") === "1";
  }

  function isCompositorVisualMode(search) {
    return new URLSearchParams(search || "").get("visual") === "compositor";
  }

  function prefersCompositorVisuals(search) {
    return new URLSearchParams(search || "").get("visual") !== "raf";
  }

  function calculateVisualSongStartMs(performanceNowMs, audioNowSec, audioStartSec) {
    if (
      !Number.isFinite(performanceNowMs) ||
      !Number.isFinite(audioNowSec) ||
      !Number.isFinite(audioStartSec)
    ) return 0;
    return performanceNowMs + (audioStartSec - audioNowSec) * 1000;
  }

  // 振動ズレ対策の初期化用: 読み取りギャップ(performance.now の前後差)が
  // 最も小さい = 最もジャンクの無いサンプルを採用する。
  function pickTightestSync(samples) {
    if (!samples || !samples.length) return null;
    return samples.reduce((best, s) => (s.gapMs < best.gapMs ? s : best), samples[0]);
  }

  // performance.now ↔ AudioContext.currentTime の対応を素早く複数回測り、
  // 最も信頼できる1組を返す。演奏開始時に一度だけ呼んで壁時計アンカーを安定させる。
  function measureAudioWallSync(audio, count) {
    const n = count || 5;
    const samples = [];
    for (let i = 0; i < n; i += 1) {
      const t0 = performance.now();
      const a = audio.currentTime;
      const t1 = performance.now();
      samples.push({ perfMs: (t0 + t1) / 2, audioSec: a, gapMs: t1 - t0 });
    }
    return pickTightestSync(samples);
  }

  function calculateNoteAnimationDelayMs(
    songStartMs,
    noteTimeSec,
    appearSec,
    timelineNowMs
  ) {
    if (
      !Number.isFinite(songStartMs) ||
      !Number.isFinite(noteTimeSec) ||
      !Number.isFinite(appearSec) ||
      !Number.isFinite(timelineNowMs)
    ) return 0;
    return songStartMs + (noteTimeSec - appearSec) * 1000 - timelineNowMs;
  }

  function calculateClockDriftMs(audioSongTime, wallSongTime) {
    if (!Number.isFinite(audioSongTime) || !Number.isFinite(wallSongTime)) return 0;
    return (wallSongTime - audioSongTime) * 1000;
  }

  function classifyBeatPhase(beatPosition, groove) {
    const fraction = beatPosition - Math.floor(beatPosition);
    if (Math.abs(fraction) < 1e-9) return "head";
    if (groove === "shuffle" && Math.abs(fraction - 0.5) < 1e-9) return "swing";
    return "offbeat";
  }

  function applyGroove(beatPosition, groove) {
    if (groove !== "shuffle") return beatPosition;
    const wholeBeat = Math.floor(beatPosition);
    const fraction = beatPosition - wholeBeat;
    if (Math.abs(fraction - 0.5) < 1e-9) return wholeBeat + 2 / 3;
    return beatPosition;
  }

  function toneEvent(offsetBeats, frequency, durationBeats, wave, peak) {
    return { type: "tone", offsetBeats, frequency, durationBeats, wave, peak };
  }

  function bassEvent(offsetBeats, frequency, durationBeats, peak) {
    return { type: "bass", offsetBeats, frequency, durationBeats, peak };
  }

  function pianoEvent(offsetBeats, harmony, durationBeats, peak) {
    return {
      type: "piano",
      offsetBeats,
      name: harmony.name,
      root: harmony.chordRoot,
      intervals: [...harmony.intervals],
      durationBeats,
      peak,
    };
  }

  function buildSongBeatEvents(songId, index) {
    const song = SONG_DEFINITIONS[songId] || SONG_DEFINITIONS.straight;
    const beatInBar = index % 4;
    const phrase = Math.floor(index / 8) % song.bass.length;
    const bass = song.bass[phrase];
    const events = [];

    if (songId === "minimal") {
      if (beatInBar === 0) {
        events.push({ type: "kick", offsetBeats: 0 });
        events.push(toneEvent(0, bass, 1.45, "sine", 0.18));
        events.push(toneEvent(0.5, bass * 2.52, 0.65, "triangle", 0.065));
      }
      if (beatInBar === 2 && index % 8 === 2) {
        events.push({ type: "ride", offsetBeats: 0.5, strong: false });
        events.push(toneEvent(0.5, bass * 1.5, 0.8, "triangle", 0.08));
      }
      return events;
    }

    if (songId === "jazz") {
      const formBeat = index % 32;
      const formBar = Math.floor(formBeat / 4);
      const formBeatInBar = formBeat % 4;
      const harmony = JAZZ_TURNAROUND[formBar % JAZZ_TURNAROUND.length];
      const bassSemitone = JAZZ_RUNNING_BASS[formBar][formBeatInBar];
      const bassFrequency = harmony.bassRoot * Math.pow(2, bassSemitone / 12);
      events.push(bassEvent(0, bassFrequency, 0.84, 0.2));
      if (formBeatInBar === 0) {
        events.push(pianoEvent(0, JAZZ_PIANO_VOICINGS[formBar], 3.8, 0.075));
      }
      return events;
    }

    if (songId === "syncopated") {
      if (beatInBar === 0 || beatInBar === 2) events.push({ type: "kick", offsetBeats: 0 });
      if (beatInBar === 1 || beatInBar === 3) events.push({ type: "snare", offsetBeats: 0 });
      events.push({ type: "hat", offsetBeats: 0, strong: false });
      events.push({ type: "hat", offsetBeats: 0.5, strong: true });
      events.push(toneEvent(0.5, bass, 0.28, "sawtooth", 0.18));
      events.push(toneEvent(0.5, bass * [2, 2.52, 3, 2.38][beatInBar], 0.18, "square", 0.08));
      if (index % 8 === 7) events.push(toneEvent(0.75, bass * 4, 0.12, "triangle", 0.13));
      return events;
    }

    if (songId === "shuffle") {
      const swung = 2 / 3;
      if (beatInBar === 0 || beatInBar === 2) events.push({ type: "kick", offsetBeats: 0 });
      if (beatInBar === 1 || beatInBar === 3) events.push({ type: "snare", offsetBeats: 0 });
      events.push({ type: "hat", offsetBeats: 0, strong: beatInBar === 0 });
      events.push({ type: "hat", offsetBeats: swung, strong: false });
      events.push(toneEvent(0, bass * [1, 1.122, 1.26, 1.335][beatInBar], 0.42, "triangle", 0.2));
      events.push(toneEvent(swung, bass * [2.52, 3, 2.245, 2.67][beatInBar], 0.2, "square", 0.095));
      if (index % 8 === 6) events.push(toneEvent(swung, bass * 5.04, 0.28, "triangle", 0.16));
      return events;
    }

    if (beatInBar === 0 || beatInBar === 2) events.push({ type: "kick", offsetBeats: 0 });
    if (beatInBar === 1 || beatInBar === 3) events.push({ type: "snare", offsetBeats: 0 });
    events.push({ type: "hat", offsetBeats: 0, strong: true });
    events.push({ type: "hat", offsetBeats: 0.5, strong: false });
    events.push(toneEvent(0, bass, 0.42, "sawtooth", beatInBar === 0 ? 0.2 : 0.13));
    if (index % 16 === 14) events.push(toneEvent(0, bass * 4, 0.28, "triangle", 0.12));
    return events;
  }

  function judgeHit(offsetMs, windows) {
    const abs = Math.abs(offsetMs);
    if (abs <= windows.perfectMs) return { label: "PERFECT", rank: "perfect", damage: 18 };
    if (abs <= windows.goodMs) return { label: "GOOD", rank: "good", damage: 10 };
    return { label: "MISS", rank: "miss", damage: 0 };
  }

  function calculateHitY(hitLineOffsetTop, hitLineHeight) {
    return hitLineOffsetTop + hitLineHeight / 2;
  }

  function shouldConsumeNote(offsetMs, windows) {
    return Math.abs(offsetMs) <= windows.goodMs;
  }

  function buildNoteChart(options) {
    const bpm = options.bpm;
    const bars = options.bars;
    const song = SONG_DEFINITIONS[options.songId] || SONG_DEFINITIONS.straight;
    const pattern = CHART_DEFINITIONS[options.patternId] || CHART_DEFINITIONS.basic;
    const beat = beatSeconds(bpm);
    const notes = [];
    let id = 0;
    for (let bar = 0; bar < bars; bar += 1) {
      const beatsForBar = pattern.barBeats
        ? pattern.barBeats[bar % pattern.barBeats.length]
        : pattern.beats;
      for (const beatInBar of beatsForBar) {
        const rawBeat = bar * 4 + beatInBar;
        const phase = classifyBeatPhase(rawBeat, song.groove);
        const groovedBeat = applyGroove(rawBeat, song.groove);
        const accent = beatInBar === beatsForBar[0] && (bar % 2 === 0 || pattern.barBeats);
        const lane = [0, 1, 0, -1, 1, 0, -1, 0][id % 8];
        notes.push({
          id,
          beat: groovedBeat,
          phase,
          time: groovedBeat * beat,
          lane,
          accent,
          hit: false,
          missed: false,
        });
        id += 1;
      }
    }
    return notes;
  }

  function buildHintEventsForBeat(chart, beatIndex) {
    return chart
      .filter((note) => note.beat >= beatIndex && note.beat < beatIndex + 1)
      .map((note) => ({ noteId: note.id, time: note.time }));
  }

  function buildHintCue(songId, beatIndex) {
    const song = SONG_DEFINITIONS[songId] || SONG_DEFINITIONS.straight;
    let root;
    if (songId === "jazz") {
      const bar = Math.floor((beatIndex % 32) / 4);
      root = JAZZ_TURNAROUND[bar % JAZZ_TURNAROUND.length].bassRoot;
    } else {
      const phrase = Math.floor(beatIndex / 8) % song.bass.length;
      root = song.bass[phrase];
    }
    let frequency = root;
    while (frequency < 700) frequency *= 2;
    while (frequency > 1400) frequency /= 2;
    return {
      frequency: Number(frequency.toFixed(2)),
      durationSec: 0.11,
      clickDurationSec: 0.025,
      tonePeak: 0.075,
      clickPeak: 0.045,
    };
  }

  function formatDefeatMessage(score, combo) {
    return "スコア " + score + " / " + combo + "コンボ";
  }

  function formatTimeoutMessage(enemyHp, enemyMaxHp) {
    return "残りHP " + enemyHp + " / " + enemyMaxHp;
  }

  function calculateEnemyMaxHp(chart, ratio) {
    const perfectDamage = chart.reduce(
      (total, note) => total + 18 + (note.accent ? 6 : 0),
      0
    );
    return Math.max(1, Math.ceil(perfectDamage * ratio));
  }

  function calculateEventAudioTime(audioCurrentTime, performanceNowMs, eventTimeStampMs) {
    const elapsedMs = performanceNowMs - eventTimeStampMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 1000) return audioCurrentTime;
    return audioCurrentTime - elapsedMs / 1000;
  }

  function calculateCalibrationOffset(samples) {
    if (!samples.length) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.max(-250, Math.min(250, Math.round(median)));
  }

  function applyTimingOffset(songTime, offsetMs) {
    return songTime - offsetMs / 1000;
  }

  function parseCalibrationRecord(value, version) {
    try {
      const parsed = JSON.parse(value);
      if (parsed.version !== version || !Number.isFinite(parsed.offsetMs)) return null;
      return { version: parsed.version, offsetMs: parsed.offsetMs };
    } catch (_) {
      return null;
    }
  }

  function formatCalibrationLabel(hasCalibration, offsetMs) {
    if (!hasCalibration) return "タイミング調整";
    return "調整 " + (offsetMs > 0 ? "+" : "") + offsetMs + "ms";
  }

  function buildBassPartials(peak) {
    return [
      { ratio: 1, peak, durationRatio: 1 },
      { ratio: 2, peak: Number((peak * 0.36).toFixed(6)), durationRatio: 0.68 },
      { ratio: 3, peak: Number((peak * 0.12).toFixed(6)), durationRatio: 0.46 },
    ];
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      judgeHit,
      buildNoteChart,
      buildHintEventsForBeat,
      buildHintCue,
      calculateEnemyMaxHp,
      calculateEventAudioTime,
      calculateCalibrationOffset,
      applyTimingOffset,
      parseCalibrationRecord,
      formatCalibrationLabel,
      buildBassPartials,
      BASS_FILTER_FREQUENCY,
      formatDefeatMessage,
      formatTimeoutMessage,
      beatSeconds,
      normalizeBpm,
      countInDuration,
      calculateSongStartTime,
      buildCountInEvents,
      supportsVibration,
      calculateHapticDelayMs,
      calculateVisualBeatState,
      isDebugMode,
      calculateClockDriftMs,
      isCompositorVisualMode,
      prefersCompositorVisuals,
      calculateVisualSongStartMs,
      pickTightestSync,
      calculateNoteAnimationDelayMs,
      SONG_DEFINITIONS,
      CHART_DEFINITIONS,
      applyGroove,
      classifyBeatPhase,
      songBeatCount,
      songDurationSeconds,
      shouldScheduleBeat,
      defeatRingOutBeat,
      calculateHitY,
      shouldConsumeNote,
      stopTrackedSources,
      buildSongBeatEvents,
    };
    return;
  }

  const $ = (id) => document.getElementById(id);

  function updateVisualBeatGuide(beatIndex, pulse) {
    const guide = $("beat-guide");
    if (!guide) return;
    for (const [index, step] of Array.from(guide.children).entries()) {
      step.classList.toggle("active", index === beatIndex);
    }
    $("lane").classList.toggle("beat-pulse", Boolean(pulse));
  }

  function resetVisualBeatGuide() {
    updateVisualBeatGuide(-1, false);
  }

  function resetDiagnostics() {
    state.debugSessionActive = false;
    state.debugSongStartWallMs = 0;
    state.debugLastFrameMs = 0;
    state.debugMaxFrameGapMs = 0;
    state.debugLongFrameCount = 0;
    state.debugRenderMaxMs = 0;
    state.debugSlowRenderCount = 0;
    state.debugLastSchedulerMs = 0;
    state.debugSchedulerMaxGapMs = 0;
    state.debugSlowSchedulerCount = 0;
    state.debugFinalDriftMs = 0;
    state.debugMaxAbsDriftMs = 0;
    state.debugLastTap = "none";
    state.debugAudioState = state.audio ? state.audio.state : "none";
    state.debugStateChanges = [];
    const panel = $("diagnostics-panel");
    panel.hidden = true;
    panel.textContent = "";
  }

  function showDiagnosticsSummary(reason) {
    if (!state.debugEnabled || !state.debugSessionActive) return;
    const frameTime = performance.now();
    const audio = state.audio;
    const audioSongTime = audio && state.startTime ? audio.currentTime - state.startTime : 0;
    const wallSongTime = state.debugSongStartWallMs
      ? (frameTime - state.debugSongStartWallMs) / 1000
      : 0;
    const driftMs = calculateClockDriftMs(audioSongTime, wallSongTime);
    state.debugFinalDriftMs = driftMs;
    state.debugMaxAbsDriftMs = Math.max(state.debugMaxAbsDriftMs, Math.abs(driftMs));
    state.debugSessionActive = false;
    const baseLatency = audio && Number.isFinite(audio.baseLatency) ? audio.baseLatency * 1000 : 0;
    const outputLatency = audio && Number.isFinite(audio.outputLatency) ? audio.outputLatency * 1000 : 0;
    const userAgent = navigator.userAgent.replace(/\s+/g, " ").slice(0, 88);
    const panel = $("diagnostics-panel");
    panel.hidden = false;
    panel.textContent = [
      "DEBUG " + userAgent,
      "reason=" + reason + " audio=" + state.debugAudioState,
      "audioSec=" + audioSongTime.toFixed(3) + " wallSec=" + wallSongTime.toFixed(3),
      "drift=" + (state.debugFinalDriftMs >= 0 ? "+" : "") + state.debugFinalDriftMs.toFixed(1) + "ms maxAbs=" + state.debugMaxAbsDriftMs.toFixed(1) + "ms",
      "frameMax=" + state.debugMaxFrameGapMs.toFixed(1) + "ms >50=" + state.debugLongFrameCount,
      "renderMax=" + state.debugRenderMaxMs.toFixed(1) + "ms >8=" + state.debugSlowRenderCount,
      "timerMax=" + state.debugSchedulerMaxGapMs.toFixed(1) + "ms >75=" + state.debugSlowSchedulerCount,
      "visual=" + (state.compositorVisuals ? "compositor" : "raf"),
      "latency base=" + baseLatency.toFixed(1) + "ms out=" + outputLatency.toFixed(1) + "ms",
      "states=" + (state.debugStateChanges.join(">") || state.debugAudioState),
      "running=" + state.running + " tap=" + state.debugLastTap,
    ].join("\n");
  }

  function sampleDiagnosticsFrame(frameTime) {
    if (!state.debugEnabled || !state.debugSessionActive) return;
    if (state.debugLastFrameMs) {
      const frameGapMs = frameTime - state.debugLastFrameMs;
      state.debugMaxFrameGapMs = Math.max(state.debugMaxFrameGapMs, frameGapMs);
      if (frameGapMs > 50) state.debugLongFrameCount += 1;
    }
    state.debugLastFrameMs = frameTime;
    const audioSongTime = state.audio.currentTime - state.startTime;
    const wallSongTime = (frameTime - state.debugSongStartWallMs) / 1000;
    const driftMs = calculateClockDriftMs(audioSongTime, wallSongTime);
    state.debugFinalDriftMs = driftMs;
    state.debugMaxAbsDriftMs = Math.max(state.debugMaxAbsDriftMs, Math.abs(driftMs));
  }

  const state = {
    audio: null,
    master: null,
    startTime: 0,
    chart: [],
    noteEls: new Map(),
    compositorVisuals: false,
    visualSongStartMs: 0,
    visualAnimations: [],
    raf: 0,
    scheduler: 0,
    nextBeat: 0,
    defeated: false,
    ringOutBeat: Infinity,
    running: false,
    countingIn: false,
    countTimers: [],
    songEndTimer: 0,
    activeSources: new Set(),
    enemyMaxHp: 1,
    enemyHp: 1,
    combo: 0,
    score: 0,
    songId: "straight",
    patternId: "basic",
    hintEnabled: true,
    hapticEnabled: false,
    hapticTimers: new Set(),
    calibrationOffsetMs: 0,
    hasCalibration: false,
    calibrating: false,
    calibrationExpectedTimes: [],
    calibrationUsed: new Set(),
    calibrationSamples: [],
    calibrationTimers: [],
    debugEnabled: false,
    debugSessionActive: false,
    debugSongStartWallMs: 0,
    debugLastFrameMs: 0,
    debugMaxFrameGapMs: 0,
    debugLongFrameCount: 0,
    debugRenderMaxMs: 0,
    debugSlowRenderCount: 0,
    debugLastSchedulerMs: 0,
    debugSchedulerMaxGapMs: 0,
    debugSlowSchedulerCount: 0,
    debugFinalDriftMs: 0,
    debugMaxAbsDriftMs: 0,
    debugLastTap: "none",
    debugAudioState: "none",
    debugStateChanges: [],
  };

  function ensureAudio() {
    if (state.audio) return state.audio;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audio = new AudioContext();
    state.master = state.audio.createGain();
    state.master.gain.value = 0.72;
    state.master.connect(state.audio.destination);
    state.debugAudioState = state.audio.state;
    state.audio.addEventListener("statechange", () => {
      state.debugAudioState = state.audio.state;
      if (
        state.debugEnabled &&
        state.debugSessionActive &&
        state.debugStateChanges[state.debugStateChanges.length - 1] !== state.debugAudioState
      ) {
        state.debugStateChanges.push(state.debugAudioState);
      }
    });
    return state.audio;
  }

  function envGain(audio, time, peak, duration) {
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    return g;
  }

  function trackSource(source) {
    state.activeSources.add(source);
    source.addEventListener("ended", () => {
      state.activeSources.delete(source);
    }, { once: true });
    return source;
  }

  function stopPlayback() {
    state.running = false;
    state.countingIn = false;
    cancelVisualAnimations();
    clearInterval(state.scheduler);
    clearTimeout(state.songEndTimer);
    cancelAnimationFrame(state.raf);
    clearCountTimers();
    clearHapticTimers();
    stopTrackedSources(state.activeSources);
    state.scheduler = 0;
    state.songEndTimer = 0;
    state.raf = 0;
    resetVisualBeatGuide();
  }

  function clearHapticTimers() {
    for (const timer of state.hapticTimers) clearTimeout(timer);
    state.hapticTimers.clear();
    if (!supportsVibration(window.navigator)) return;
    try {
      navigator.vibrate(0);
    } catch (_) {
      // Vibration is optional and must never stop battle cleanup.
    }
  }

  function scheduleHaptic(audioTime) {
    if (!state.hapticEnabled || !supportsVibration(window.navigator)) return false;
    const delayMs = calculateHapticDelayMs(audioTime, state.audio.currentTime);
    if (delayMs === null) return false;
    const timer = setTimeout(() => {
      state.hapticTimers.delete(timer);
      const currentDelay = calculateHapticDelayMs(audioTime, state.audio.currentTime);
      if (
        !state.running ||
        !state.hapticEnabled ||
        document.visibilityState !== "visible" ||
        currentDelay === null
      ) return;
      try {
        navigator.vibrate(15);
      } catch (_) {
        // Unsupported hardware or OS policy must not affect gameplay.
      }
    }, delayMs);
    state.hapticTimers.add(timer);
    return true;
  }

  // 合成アニメーション(Web Animations API)の描画タイミングに合わせて振動する。
  // 拍の視覚発光は performance.now 基準の state.visualSongStartMs + 拍×beatMs で発生するため、
  // 音声時計ではなく同じ壁時計で予約し、見た目の拍と振動を一致させる(Androidの違和感対策)。
  function scheduleHapticVisual(targetWallMs, maxLateMs = 80) {
    if (!state.hapticEnabled || !supportsVibration(window.navigator)) return false;
    if (!Number.isFinite(targetWallMs)) return false;
    const delayMs = targetWallMs - performance.now();
    if (delayMs < -maxLateMs) return false;
    const timer = setTimeout(() => {
      state.hapticTimers.delete(timer);
      const lateMs = performance.now() - targetWallMs;
      if (
        !state.running ||
        !state.hapticEnabled ||
        document.visibilityState !== "visible" ||
        lateMs > maxLateMs
      ) return;
      try {
        navigator.vibrate(15);
      } catch (_) {
        // Unsupported hardware or OS policy must not affect gameplay.
      }
    }, Math.max(0, delayMs));
    state.hapticTimers.add(timer);
    return true;
  }

  function cancelVisualAnimations() {
    for (const animation of state.visualAnimations) {
      try {
        animation.cancel();
      } catch (_) {
        // Animation may already be detached after a judged note is removed.
      }
    }
    state.visualAnimations = [];
    state.visualSongStartMs = 0;
    for (const step of document.querySelectorAll(".beat-guide-step")) {
      step.classList.remove("compositor-guide");
    }
  }

  function playTone(time, freq, duration, type, peak) {
    const audio = state.audio;
    const osc = audio.createOscillator();
    const g = envGain(audio, time, peak, duration);
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.985, time + duration);
    osc.connect(g).connect(state.master);
    trackSource(osc);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  function playKick(time) {
    const audio = state.audio;
    const osc = audio.createOscillator();
    const g = envGain(audio, time, 0.95, 0.2);
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.16);
    osc.connect(g).connect(state.master);
    trackSource(osc);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  function playHat(time, strong) {
    const audio = state.audio;
    const buffer = audio.createBuffer(1, audio.sampleRate * 0.045, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const g = envGain(audio, time, strong ? 0.22 : 0.11, 0.055);
    filter.type = "highpass";
    filter.frequency.value = 6500;
    src.buffer = buffer;
    src.connect(filter).connect(g).connect(state.master);
    trackSource(src);
    src.start(time);
  }

  function playSnare(time) {
    const audio = state.audio;
    const buffer = audio.createBuffer(1, audio.sampleRate * 0.12, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const g = envGain(audio, time, 0.42, 0.12);
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    src.buffer = buffer;
    src.connect(filter).connect(g).connect(state.master);
    trackSource(src);
    src.start(time);
    playTone(time, 220, 0.08, "triangle", 0.08);
  }

  function playHintCue(time, cue) {
    const audio = state.audio;
    const duration = cue.clickDurationSec;
    const buffer = audio.createBuffer(1, audio.sampleRate * duration, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const fade = Math.pow(1 - i / data.length, 3);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const g = envGain(audio, time, cue.clickPeak, duration);
    filter.type = "bandpass";
    filter.frequency.value = 4800;
    filter.Q.value = 0.8;
    src.buffer = buffer;
    src.connect(filter).connect(g).connect(state.master);
    trackSource(src);
    src.start(time);
    playTone(time, cue.frequency, cue.durationSec, "triangle", cue.tonePeak);
  }

  function clearCalibrationTimers() {
    for (const timer of state.calibrationTimers) clearTimeout(timer);
    state.calibrationTimers = [];
  }

  function updateCalibrationButton() {
    const button = $("calibration-btn");
    button.textContent = formatCalibrationLabel(state.hasCalibration, state.calibrationOffsetMs);
    button.classList.toggle("pending", !state.hasCalibration);
  }

  function loadCalibration() {
    let record = null;
    try {
      record = parseCalibrationRecord(
        localStorage.getItem(CALIBRATION_STORAGE_KEY),
        SETTINGS.calibrationVersion
      );
    } catch (_) {
      // Storage may be unavailable in private browsing.
    }
    state.calibrationOffsetMs = record ? record.offsetMs : 0;
    state.hasCalibration = Boolean(record);
    updateCalibrationButton();
  }

  function saveCalibration(offsetMs) {
    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify({
        version: SETTINGS.calibrationVersion,
        offsetMs,
      }));
    } catch (_) {
      // The value remains active for this session if storage is unavailable.
    }
  }

  function finishCalibration() {
    clearCalibrationTimers();
    stopTrackedSources(state.activeSources);
    const enoughSamples = state.calibrationSamples.length >= 5;
    state.calibrating = false;
    $("attack-btn").disabled = true;
    $("start-btn").disabled = false;
    $("calibration-btn").disabled = false;
    if (enoughSamples) {
      state.calibrationOffsetMs = calculateCalibrationOffset(state.calibrationSamples);
      state.hasCalibration = true;
      saveCalibration(state.calibrationOffsetMs);
      $("calibration-status").textContent = "調整完了: " +
        (state.calibrationOffsetMs > 0 ? "+" : "") + state.calibrationOffsetMs + "ms";
      updateCalibrationButton();
    } else {
      $("calibration-status").textContent = "計測不足です。もう一度お試しください";
    }
    state.calibrationTimers.push(setTimeout(() => {
      $("calibration-panel").hidden = true;
    }, 1800));
  }

  function recordCalibrationTap(event) {
    const inputTime = calculateEventAudioTime(
      state.audio.currentTime,
      performance.now(),
      event.timeStamp
    );
    let nearestIndex = -1;
    let nearestDiffMs = Infinity;
    state.calibrationExpectedTimes.forEach((expected, index) => {
      if (state.calibrationUsed.has(index)) return;
      const diffMs = (inputTime - expected) * 1000;
      if (Math.abs(diffMs) < Math.abs(nearestDiffMs)) {
        nearestIndex = index;
        nearestDiffMs = diffMs;
      }
    });
    if (nearestIndex < 0 || Math.abs(nearestDiffMs) > 300) return;
    state.calibrationUsed.add(nearestIndex);
    if (nearestIndex >= 2) state.calibrationSamples.push(nearestDiffMs);
    $("calibration-status").textContent = nearestIndex < 2
      ? "練習 " + (nearestIndex + 1) + " / 2"
      : "計測 " + state.calibrationSamples.length + " / 8";
    if (state.calibrationSamples.length >= 8) {
      // 8拍目は「8 / 8 完了!」を見せてから少し遅らせて完了処理へ。
      // (同期で finishCalibration を呼ぶと 8/8 が描画される前に「調整完了」へ上書きされる)
      // 併せてフォールバック完了タイマーも止め、確実に 8/8 を表示する。
      clearCalibrationTimers();
      state.calibrating = false;
      $("calibration-status").textContent = "計測 8 / 8 完了!";
      state.calibrationTimers.push(setTimeout(finishCalibration, 600));
    }
  }

  async function startCalibration() {
    const audio = ensureAudio();
    if (audio.state !== "running") await audio.resume();
    stopPlayback();
    clearCalibrationTimers();
    state.calibrating = true;
    state.calibrationSamples = [];
    state.calibrationUsed = new Set();
    state.calibrationExpectedTimes = [];
    $("calibration-panel").hidden = false;
    $("calibration-status").textContent = "2拍練習後、8拍を音に合わせてタップ";
    $("attack-btn").disabled = false;
    $("start-btn").disabled = true;
    $("calibration-btn").disabled = true;
    const interval = 0.6;
    const firstTime = audio.currentTime + 1;
    const cue = { frequency: 880, durationSec: 0.11, clickDurationSec: 0.025, tonePeak: 0.3, clickPeak: 0.24 };
    for (let index = 0; index < 10; index += 1) {
      const time = firstTime + index * interval;
      state.calibrationExpectedTimes.push(time);
      playHintCue(time, cue);
    }
    state.calibrationTimers.push(setTimeout(
      finishCalibration,
      (firstTime + 10 * interval - audio.currentTime) * 1000
    ));
  }

  function playBrush(time, strong) {
    const audio = state.audio;
    const duration = strong ? 0.24 : 0.16;
    const buffer = audio.createBuffer(1, audio.sampleRate * duration, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const fade = Math.pow(1 - i / data.length, 1.4);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const g = envGain(audio, time, strong ? 0.18 : 0.1, duration);
    filter.type = "bandpass";
    filter.frequency.value = 1350;
    filter.Q.value = 0.7;
    src.buffer = buffer;
    src.connect(filter).connect(g).connect(state.master);
    trackSource(src);
    src.start(time);
  }

  function playRide(time, strong) {
    const audio = state.audio;
    const frequencies = [410, 613, 947];
    frequencies.forEach((frequency, index) => {
      const osc = audio.createOscillator();
      const duration = strong ? 0.65 : 0.42;
      const g = envGain(audio, time, (strong ? 0.075 : 0.04) / (index + 1), duration);
      osc.type = index === 0 ? "triangle" : "square";
      osc.frequency.setValueAtTime(frequency, time);
      osc.connect(g).connect(state.master);
      trackSource(osc);
      osc.start(time);
      osc.stop(time + duration + 0.03);
    });
  }

  function playBass(time, event) {
    const audio = state.audio;
    const duration = event.durationBeats * beatSeconds(SETTINGS.bpm);
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(BASS_FILTER_FREQUENCY, time);
    filter.Q.value = 0.8;
    filter.connect(state.master);

    buildBassPartials(event.peak).forEach((partial) => {
      const osc = audio.createOscillator();
      const g = envGain(audio, time, partial.peak, duration * partial.durationRatio);
      osc.type = "sine";
      osc.frequency.setValueAtTime(event.frequency * partial.ratio, time);
      osc.frequency.exponentialRampToValueAtTime(
        event.frequency * partial.ratio * 0.992,
        time + duration * partial.durationRatio
      );
      osc.connect(g).connect(filter);
      trackSource(osc);
      osc.start(time);
      osc.stop(time + duration * partial.durationRatio + 0.03);
    });
  }

  function playPiano(time, event) {
    const audio = state.audio;
    const duration = event.durationBeats * beatSeconds(SETTINGS.bpm);
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3200, time);
    filter.Q.value = 0.45;
    filter.connect(state.master);
    const voicePeak = event.peak / Math.sqrt(event.intervals.length);

    event.intervals.forEach((semitone, voiceIndex) => {
      const frequency = event.root * Math.pow(2, semitone / 12);
      [
        { ratio: 1, level: 1, decay: 1 },
        { ratio: 2, level: 0.28, decay: 0.58 },
        { ratio: 3, level: 0.09, decay: 0.32 },
      ].forEach((partial) => {
        const partialDuration = duration * partial.decay;
        const osc = audio.createOscillator();
        const g = envGain(audio, time, voicePeak * partial.level, partialDuration);
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency * partial.ratio, time);
        osc.detune.value = voiceIndex % 2 === 0 ? -2 : 2;
        osc.connect(g).connect(filter);
        trackSource(osc);
        osc.start(time);
        osc.stop(time + partialDuration + 0.03);
      });
    });
  }

  function playCountTone(time, beatNumber) {
    const frequency = beatNumber === 1 ? 1046.5 : 783.99;
    playTone(time, frequency, 0.12, "square", beatNumber === 1 ? 0.24 : 0.16);
  }

  function clearCountTimers() {
    for (const timer of state.countTimers) clearTimeout(timer);
    state.countTimers = [];
  }

  function scheduleCountIn(countInStartTime) {
    clearCountTimers();
    const beat = beatSeconds(SETTINGS.bpm);
    const countEl = $("count-in");
    countEl.hidden = false;

    for (const event of buildCountInEvents()) {
      const time = countInStartTime + event.beatOffset * beat;
      playCountTone(time, event.label);
      scheduleHaptic(time);
      const delayMs = Math.max(0, (time - state.audio.currentTime) * 1000);
      state.countTimers.push(setTimeout(() => {
        countEl.textContent = String(event.label);
        updateVisualBeatGuide(event.guideIndex, true);
        state.countTimers.push(setTimeout(() => {
          if (state.countingIn) updateVisualBeatGuide(event.guideIndex, false);
        }, 120));
      }, delayMs));
    }

    const startDelayMs = Math.max(0, (state.startTime - state.audio.currentTime) * 1000);
    // 入力受付は最初の音(ダウンビート)の少し前から開く。最初のノーツが曲頭(時刻0)に
    // ある譜面で、頭ぴったり〜わずかに先行したタップが取りこぼされてMISSになるのを防ぐ。
    // 先行量はGOOD判定窓ぶん(±180ms)とし、GOOD内の早入力を確実に受け付ける。
    const inputLeadMs = SETTINGS.goodMs;
    const inputEnableDelayMs = Math.max(0, startDelayMs - inputLeadMs);
    state.countTimers.push(setTimeout(() => {
      state.countingIn = false;
      $("attack-btn").disabled = false;
      $("start-btn").disabled = false;
    }, inputEnableDelayMs));
    state.countTimers.push(setTimeout(() => {
      countEl.textContent = "START!";
      if (state.compositorVisuals) resetVisualBeatGuide();
      else updateVisualBeatGuide(0, true);
      addLog("戦闘開始。リズムに合わせてこうげき!");
      state.countTimers.push(setTimeout(() => {
        countEl.hidden = true;
      }, 450));
    }, startDelayMs));
  }

  function scheduleSongBeat(songId, index, time) {
    const beat = beatSeconds(SETTINGS.bpm);
    for (const event of buildSongBeatEvents(songId, index)) {
      const eventTime = time + event.offsetBeats * beat;
      if (event.type === "kick") playKick(eventTime);
      if (event.type === "snare") playSnare(eventTime);
      if (event.type === "hat") playHat(eventTime, event.strong);
      if (event.type === "brush") playBrush(eventTime, event.strong);
      if (event.type === "ride") playRide(eventTime, event.strong);
      if (event.type === "bass") playBass(eventTime, event);
      if (event.type === "piano") playPiano(eventTime, event);
      if (event.type === "tone") {
        playTone(
          eventTime,
          event.frequency,
          event.durationBeats * beat,
          event.wave,
          event.peak
        );
      }
    }
  }

  function schedulerTick() {
    if (!state.running) return;
    if (state.debugEnabled && state.debugSessionActive) {
      const schedulerNowMs = performance.now();
      if (state.debugLastSchedulerMs) {
        const schedulerGapMs = schedulerNowMs - state.debugLastSchedulerMs;
        state.debugSchedulerMaxGapMs = Math.max(state.debugSchedulerMaxGapMs, schedulerGapMs);
        if (schedulerGapMs > 75) state.debugSlowSchedulerCount += 1;
      }
      state.debugLastSchedulerMs = schedulerNowMs;
    }
    const audio = state.audio;
    // 定期リシンク(C): 振動アンカー visualSongStartMs を生の音声↔壁時計対応へ
    // 緩やかに追従させ、曲を通して振動が音からずれないようにする(指数平滑で1読みのジッタを抑制)。
    if (SETTINGS.hapticResyncEnabled && audio) {
      const freshAnchorMs = performance.now() + (state.startTime - audio.currentTime) * 1000;
      if (Number.isFinite(freshAnchorMs)) {
        state.visualSongStartMs += (freshAnchorMs - state.visualSongStartMs) * 0.2;
      }
    }
    const beat = beatSeconds(SETTINGS.bpm);
    while (
      shouldScheduleBeat(state.nextBeat, SETTINGS.bars, 4) &&
      state.nextBeat < state.ringOutBeat &&
      state.startTime + state.nextBeat * beat < audio.currentTime + SETTINGS.lookAheadSec
    ) {
      const beatTime = state.startTime + state.nextBeat * beat;
      scheduleSongBeat(state.songId, state.nextBeat, beatTime);
      if (state.compositorVisuals) {
        // 合成アニメの拍発光と同じ壁時計で振動を予約し、見た目と一致させる
        scheduleHapticVisual(state.visualSongStartMs + state.nextBeat * beat * 1000);
      } else {
        scheduleHaptic(beatTime);
      }
      if (state.hintEnabled) {
        const cue = buildHintCue(state.songId, state.nextBeat);
        for (const hint of buildHintEventsForBeat(state.chart, state.nextBeat)) {
          playHintCue(state.startTime + hint.time, cue);
        }
      }
      state.nextBeat += 1;
    }
    if (!shouldScheduleBeat(state.nextBeat, SETTINGS.bars, 4) || state.nextBeat >= state.ringOutBeat) {
      clearInterval(state.scheduler);
      state.scheduler = 0;
    }
  }

  function removeNoteElement(noteId) {
    const noteEl = state.noteEls.get(noteId);
    if (noteEl) noteEl.remove();
    state.noteEls.delete(noteId);
  }

  function clearVisualNotes() {
    $("notes").innerHTML = "";
    state.noteEls.clear();
  }

  function prepareCompositorNotes(songStartMs) {
    const appearSec = 2;
    const exitSec = 0.18;
    const lane = $("lane");
    const hitLine = lane.querySelector(".hit-line");
    const hitY = calculateHitY(hitLine.offsetTop, hitLine.offsetHeight);
    const travel = hitY + 50;
    const exitTravel = travel * exitSec / appearSec;
    const duration = (appearSec + exitSec) * 1000;
    const hitOffset = appearSec / (appearSec + exitSec);
    const timelineNow = document.timeline && Number.isFinite(document.timeline.currentTime)
      ? document.timeline.currentTime
      : performance.now();

    for (const note of state.chart) {
      const motionEl = document.createElement("div");
      motionEl.className = "note-motion compositor-note-motion";
      motionEl.style.left = (note.phase === "head" ? 27 : 73) + "%";
      motionEl.style.top = "-50px";
      const noteEl = document.createElement("div");
      noteEl.className = "note phase-" + note.phase + (note.accent ? " accent" : "");
      noteEl.setAttribute("aria-label", note.phase === "head" ? "表拍" : "裏拍");
      motionEl.appendChild(noteEl);
      $("notes").appendChild(motionEl);
      state.noteEls.set(note.id, motionEl);

      const delay = calculateNoteAnimationDelayMs(
        songStartMs,
        note.time,
        appearSec,
        timelineNow
      );
      const animation = motionEl.animate([
        { transform: "translate3d(0, 0, 0)", opacity: 1, offset: 0 },
        { transform: "translate3d(0, " + travel + "px, 0)", opacity: 1, offset: hitOffset },
        { transform: "translate3d(0, " + (travel + exitTravel) + "px, 0)", opacity: 0, offset: 1 },
      ], {
        duration,
        delay,
        easing: "linear",
        fill: "none",
      });
      animation.startTime = timelineNow;
      state.visualAnimations.push(animation);
    }
  }

  function prepareCompositorBeatGuide(songStartMs) {
    const steps = $("beat-guide").querySelectorAll(".beat-guide-step");
    const beatMs = beatSeconds(SETTINGS.bpm) * 1000;
    const barMs = beatMs * 4;
    const pulseOffset = Math.min(0.25, 120 / barMs);
    const releaseOffset = Math.min(0.3, pulseOffset + 0.04);
    const timelineNow = document.timeline && Number.isFinite(document.timeline.currentTime)
      ? document.timeline.currentTime
      : performance.now();

    steps.forEach((step, index) => {
      step.classList.add("compositor-guide");
      const flash = step.querySelector(".beat-guide-flash");
      const animation = step.animate([
        { transform: "scaleY(1.5)", offset: 0 },
        { transform: "scaleY(1.5)", offset: pulseOffset },
        { transform: "scaleY(1)", offset: releaseOffset },
        { transform: "scaleY(1)", offset: 1 },
      ], {
        duration: barMs,
        delay: songStartMs + index * beatMs - timelineNow,
        easing: "linear",
        iterations: Infinity,
        fill: "none",
      });
      animation.startTime = timelineNow;
      state.visualAnimations.push(animation);

      const flashAnimation = flash.animate([
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: pulseOffset },
        { opacity: 0, offset: releaseOffset },
        { opacity: 0, offset: 1 },
      ], {
        duration: barMs,
        delay: songStartMs + index * beatMs - timelineNow,
        easing: "linear",
        iterations: Infinity,
        fill: "none",
      });
      flashAnimation.startTime = timelineNow;
      state.visualAnimations.push(flashAnimation);
    });
  }

  function compositorTimelineNow() {
    return document.timeline && Number.isFinite(document.timeline.currentTime)
      ? document.timeline.currentTime
      : performance.now();
  }

  // 判定線フラッシュのディスパッチャ。SETTINGS.hitLineFlashByNotes で挙動切替。
  function prepareCompositorHitLine(songStartMs) {
    if (SETTINGS.hitLineFlashByNotes) {
      prepareCompositorHitLineByNotes(songStartMs);
    } else {
      prepareCompositorHitLineByBeats(songStartMs);
    }
  }

  // 【従来挙動】4分音符ごとに等間隔フラッシュ(復元用に保持)。
  function prepareCompositorHitLineByBeats(songStartMs) {
    const flash = $("lane").querySelector(".hit-line-flash");
    const beatMs = beatSeconds(SETTINGS.bpm) * 1000;
    const pulseOffset = Math.min(0.5, 120 / beatMs);
    const timelineNow = compositorTimelineNow();
    const animation = flash.animate([
      { transform: "scaleX(1)", opacity: 1, offset: 0 },
      { transform: "scaleX(1)", opacity: 1, offset: pulseOffset * 0.45 },
      { transform: "scaleX(0.96)", opacity: 0, offset: pulseOffset },
      { transform: "scaleX(0.96)", opacity: 0, offset: 1 },
    ], {
      duration: beatMs,
      delay: songStartMs - timelineNow,
      easing: "linear",
      iterations: Infinity,
      fill: "none",
    });
    animation.startTime = timelineNow;
    state.visualAnimations.push(animation);
  }

  // 【新挙動】タップすべきタイミング(譜面の各 note.time)に同期して単発フラッシュ。
  // 各ノーツが判定線へ到達する壁時計 songStartMs + note.time*1000 を起点に短いパルス。
  // 発光色は落下ノーツに合わせる: 頭=黄 / 裏=水色 / シャッフル裏=紫。
  // アクセントは明るく(不透明度・発光を強調)。非フラッシュ時の地色は CSS の明るめグレー。
  const HITLINE_FLASH_COLORS = {
    head: { color: "#facc15", glow: "rgba(250, 204, 21, 0.95)" },
    offbeat: { color: "#22d3ee", glow: "rgba(34, 211, 238, 0.95)" },
    swing: { color: "#c084fc", glow: "rgba(192, 132, 252, 0.95)" },
  };

  function prepareCompositorHitLineByNotes(songStartMs) {
    const flash = $("lane").querySelector(".hit-line-flash");
    const beatMs = beatSeconds(SETTINGS.bpm) * 1000;
    const flashMs = Math.max(90, Math.min(beatMs * 0.5, 180));
    const timelineNow = compositorTimelineNow();
    for (const note of state.chart) {
      const arriveMs = songStartMs + note.time * 1000;
      const c = HITLINE_FLASH_COLORS[note.phase] || HITLINE_FLASH_COLORS.head;
      const peak = note.accent ? 1 : 0.85; // アクセントは明るく
      const shadow = (note.accent ? "0 0 42px 12px " : "0 0 30px 7px ") + c.glow;
      const animation = flash.animate([
        { backgroundColor: c.color, boxShadow: shadow, opacity: peak, transform: "scaleX(1)", offset: 0 },
        { backgroundColor: c.color, boxShadow: shadow, opacity: 0, transform: "scaleX(0.97)", offset: 1 },
      ], {
        duration: flashMs,
        delay: arriveMs - timelineNow,
        easing: "ease-out",
        fill: "none",
      });
      animation.startTime = timelineNow;
      state.visualAnimations.push(animation);
    }
  }

  function finishSong() {
    if (!state.running) return;
    stopPlayback();
    showDiagnosticsSummary("timeout");
    clearVisualNotes();
    $("attack-btn").disabled = true;
    $("start-btn").disabled = false;
    $("judge").textContent = "時間切れ";
    $("judge").className = "judge";
    $("battle-result-title").textContent = "時間切れ";
    $("battle-result-detail").textContent = formatTimeoutMessage(state.enemyHp, state.enemyMaxHp);
    $("battle-result").className = "battle-result timeout";
    $("battle-result").hidden = false;
    addLog("時間切れ。敵を撃破できなかった");
    if (window.RhythmBridge && window.RhythmBridge.onRoundEnd) {
      window.RhythmBridge.onRoundEnd({ score: state.score, combo: state.combo, cleared: false, misses: state.missCount });
    }
  }

  function scheduleSongEnd() {
    const endTime = state.startTime + songDurationSeconds(SETTINGS.bpm, SETTINGS.bars, 4);
    const delayMs = Math.max(0, (endTime - state.audio.currentTime) * 1000);
    clearTimeout(state.songEndTimer);
    state.songEndTimer = setTimeout(finishSong, delayMs);
  }

  function resetBattle() {
    clearVisualNotes();
    state.chart = buildNoteChart({
      bpm: SETTINGS.bpm,
      bars: SETTINGS.bars,
      songId: state.songId,
      patternId: state.patternId,
    });
    state.nextBeat = 0;
    state.defeated = false;
    state.ringOutBeat = Infinity;
    state.missCount = 0;
    if (SETTINGS.markerAttackMode) state.chart = []; // 弱点攻撃は落下ノーツを使わない
    state.enemyMaxHp = calculateEnemyMaxHp(state.chart, SETTINGS.clearHpRatio);
    state.enemyHp = state.enemyMaxHp;
    state.combo = 0;
    state.score = 0;
    $("judge").textContent = "READY";
    $("judge").className = "judge";
    $("count-in").hidden = true;
    $("battle-result").className = "battle-result";
    $("battle-result").hidden = true;
    $("attack-btn").disabled = true; // 停止中は「こうげき」を非活性表示(演奏開始で解除)
    $("log").innerHTML = "";
    resetVisualBeatGuide();
    updateStats();
  }

  function addLog(text) {
    const el = document.createElement("div");
    el.textContent = text;
    $("log").prepend(el);
  }

  function updateStats() {
    $("enemy-hp").textContent = String(Math.max(0, state.enemyHp));
    $("enemy-hp-fill").style.width = Math.max(0, state.enemyHp / state.enemyMaxHp * 100) + "%";
    $("combo").textContent = String(state.combo);
    $("score").textContent = String(state.score);
  }

  function showJudge(result, offsetMs) {
    const judge = $("judge");
    judge.textContent = result.label + " " + (offsetMs > 0 ? "+" : "") + Math.round(offsetMs) + "ms";
    judge.className = "judge " + result.rank;
  }

  function currentSongTime() {
    return state.audio.currentTime - state.startTime;
  }

  function inputSongTime(event) {
    const audioTime = event
      ? calculateEventAudioTime(state.audio.currentTime, performance.now(), event.timeStamp)
      : state.audio.currentTime;
    return applyTimingOffset(audioTime - state.startTime, state.calibrationOffsetMs);
  }

  function findNearestNote(now) {
    let best = null;
    for (const note of state.chart) {
      if (note.hit || note.missed) continue;
      const diff = (now - note.time) * 1000;
      if (!best || Math.abs(diff) < Math.abs(best.diffMs)) best = { note, diffMs: diff };
    }
    return best;
  }

  // 撃破処理: 即停止せず撃破表示をしたうえで、小節末(または次の1小節)まで鳴動させる。
  function handleDefeat(hitSongTime) {
    state.defeated = true;
    clearVisualNotes();
    showDiagnosticsSummary("victory");
    $("attack-btn").disabled = true;
    $("battle-result-title").textContent = "撃破！";
    $("battle-result-detail").textContent = formatDefeatMessage(state.score, state.combo);
    $("battle-result").className = "battle-result victory";
    $("battle-result").hidden = false;
    // 鳴動範囲を決定し、スケジューラの予約上限に設定
    const beat = beatSeconds(SETTINGS.bpm);
    state.ringOutBeat = defeatRingOutBeat(hitSongTime, SETTINGS.bpm, SETTINGS.bars);
    // 時間切れ完了タイマーは無効化(撃破済みのため)
    clearTimeout(state.songEndTimer);
    // 鳴動終了時刻に停止＋ラウンド終了通知を予約(songEndTimer 枠を再利用)
    const stopAtSec = state.startTime + state.ringOutBeat * beat;
    const delayMs = Math.max(0, (stopAtSec - state.audio.currentTime) * 1000);
    state.songEndTimer = setTimeout(finishDefeatRingOut, delayMs);
  }

  function finishDefeatRingOut() {
    stopPlayback();
    $("start-btn").disabled = false;
    if (window.RhythmBridge && window.RhythmBridge.onRoundEnd) {
      window.RhythmBridge.onRoundEnd({ score: state.score, combo: state.combo, cleared: true, misses: state.missCount });
    }
  }

  function attack(event) {
    if (event) event.preventDefault();
    if (state.calibrating) {
      state.debugLastTap = "calibration";
      recordCalibrationTap(event);
      return;
    }
    if (!state.running || state.countingIn) {
      state.debugLastTap = state.countingIn ? "ignored:count-in" : "ignored:not-running";
      return;
    }
    if (state.defeated) return; // 撃破後はリングアウト中。入力は受け付けない。
    const nearest = findNearestNote(inputSongTime(event));
    if (!nearest) return;
    const result = judgeHit(nearest.diffMs, SETTINGS);
    state.debugLastTap = result.label + " " + (nearest.diffMs >= 0 ? "+" : "") + Math.round(nearest.diffMs) + "ms";
    if (shouldConsumeNote(nearest.diffMs, SETTINGS)) {
      nearest.note.hit = true;
      removeNoteElement(nearest.note.id);
    }
    if (result.rank === "miss") {
      state.combo = 0;
      state.missCount += 1;
      addLog("ミス! 攻撃は空を切った");
    } else {
      const damage = result.damage + (nearest.note.accent ? 6 : 0);
      state.enemyHp = Math.max(0, state.enemyHp - damage);
      state.combo += 1;
      state.score += result.rank === "perfect" ? 1200 : 600;
      addLog(result.label + "! " + damage + "ダメージ");
      if (state.enemyHp <= 0) {
        addLog("ビートスライムを撃破!");
        handleDefeat(nearest.note.time);
      }
    }
    showJudge(result, nearest.diffMs);
    updateStats();
  }

  function renderVisual(frameTime) {
    if (!state.running) return;
    const renderStartedMs = state.debugEnabled && state.debugSessionActive
      ? performance.now()
      : 0;
    const now = currentSongTime();
    const visualBeat = calculateVisualBeatState(now, SETTINGS.bpm);
    if (!state.countingIn && !state.compositorVisuals) {
      updateVisualBeatGuide(visualBeat.beatIndex, visualBeat.pulse);
    }
    const appear = 2.0;
    let hitY = 0;
    let travel = 0;
    if (!state.compositorVisuals) {
      const lane = $("lane");
      const hitLine = lane.querySelector(".hit-line");
      hitY = calculateHitY(hitLine.offsetTop, hitLine.offsetHeight);
      travel = hitY + 50;
    }

    for (const note of state.chart) {
      const until = note.time - now;
      if (until < -0.16 && !note.hit && !note.missed && !state.defeated) {
        note.missed = true;
        removeNoteElement(note.id);
        state.combo = 0;
        state.missCount += 1;
        showJudge({ label: "MISS", rank: "miss", damage: 0 }, until * -1000);
        addLog("ミス! タイミングを逃した");
        updateStats();
      }
      if (state.compositorVisuals) continue;
      if (until > appear || until < -0.18 || note.hit || note.missed) continue;
      let el = state.noteEls.get(note.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "note phase-" + note.phase + (note.accent ? " accent" : "");
        el.setAttribute("aria-label", note.phase === "head" ? "表拍" : "裏拍");
        $("notes").appendChild(el);
        state.noteEls.set(note.id, el);
      }
      const x = note.phase === "head" ? 27 : 73;
      const y = hitY - (until / appear) * travel;
      el.style.left = x + "%";
      el.style.top = y + "px";
    }
    const renderFinishedMs = performance.now();
    if (renderStartedMs) {
      const renderDurationMs = renderFinishedMs - renderStartedMs;
      state.debugRenderMaxMs = Math.max(state.debugRenderMaxMs, renderDurationMs);
      if (renderDurationMs > 8) state.debugSlowRenderCount += 1;
    }
  }

  function render(frameTime) {
    if (!state.running) return;
    const currentFrameTime = Number.isFinite(frameTime) ? frameTime : performance.now();
    sampleDiagnosticsFrame(currentFrameTime);
    renderVisual(currentFrameTime);
    state.raf = requestAnimationFrame(render);
  }

  async function start() {
    const audio = ensureAudio();
    if (audio.state !== "running") await audio.resume();
    stopPlayback();
    SETTINGS.bpm = normalizeBpm($("bpm-input").value, 80, 180);
    state.songId = SONG_DEFINITIONS[$("song-select").value] ? $("song-select").value : "straight";
    state.patternId = CHART_DEFINITIONS[$("pattern-select").value] ? $("pattern-select").value : "basic";
    state.hintEnabled = $("hint-toggle").checked;
    state.hapticEnabled = supportsVibration(window.navigator) && $("haptic-toggle").checked;
    $("bpm-input").value = String(SETTINGS.bpm);
    $("bpm-label").textContent = String(SETTINGS.bpm);
    resetBattle();
    state.running = true;
    state.countingIn = true;
    $("attack-btn").disabled = true;
    $("start-btn").disabled = true;
    const countInStartTime = audio.currentTime + SETTINGS.startLeadSec;
    state.startTime = calculateSongStartTime(countInStartTime, SETTINGS.bpm, 8);
    // 振動ズレ対策の初期化: 壁時計アンカーをジャンクの少ないサンプルで確定する。
    // あわせて振動サブシステムをウォームアップ(初回発火の遅延を軽減)。
    if (state.hapticEnabled) {
      try { navigator.vibrate(0); } catch (_) { /* 任意機能。失敗してもプレイに影響させない */ }
    }
    const wallSync = measureAudioWallSync(audio, 5);
    state.visualSongStartMs = wallSync
      ? calculateVisualSongStartMs(wallSync.perfMs, wallSync.audioSec, state.startTime)
      : calculateVisualSongStartMs(performance.now(), audio.currentTime, state.startTime);
    if (state.compositorVisuals) {
      if (!SETTINGS.markerAttackMode) prepareCompositorNotes(state.visualSongStartMs);
      prepareCompositorBeatGuide(state.visualSongStartMs);
      prepareCompositorHitLine(state.visualSongStartMs);
    }
    resetDiagnostics();
    state.debugSessionActive = state.debugEnabled;
    state.debugSongStartWallMs = performance.now()
      + (state.startTime - audio.currentTime) * 1000;
    state.debugAudioState = audio.state;
    state.debugStateChanges = [audio.state];
    scheduleCountIn(countInStartTime);
    scheduleSongEnd();
    state.scheduler = setInterval(schedulerTick, 25);
    schedulerTick();
    addLog(
      SONG_DEFINITIONS[state.songId].label + " / " +
      CHART_DEFINITIONS[state.patternId].label + "：4カウント後に開始!"
    );
    render();
  }

  function bind() {
    state.debugEnabled = isDebugMode(window.location.search);
    // 判定線フラッシュの挙動を URL で切替できる(?hitline=beats で従来挙動へ)
    if (new URLSearchParams(window.location.search).get("hitline") === "beats") {
      SETTINGS.hitLineFlashByNotes = false;
    }
    if (new URLSearchParams(window.location.search).get("resync") === "off") {
      SETTINGS.hapticResyncEnabled = false;
    }
    state.compositorVisuals = prefersCompositorVisuals(window.location.search) &&
      typeof Element !== "undefined" &&
      typeof Element.prototype.animate === "function";
    const hapticSupported = supportsVibration(window.navigator);
    $("haptic-toggle").disabled = !hapticSupported;
    if (!hapticSupported) {
      $("haptic-toggle").checked = false;
      $("haptic-label").textContent = "振動×";
      $("haptic-toggle").title = "このブラウザは振動に対応していません";
    }
    $("bpm-label").textContent = String(SETTINGS.bpm);
    $("bpm-input").value = String(SETTINGS.bpm);
    $("start-btn").addEventListener("click", start);
    $("attack-btn").addEventListener("pointerdown", attack);
    $("calibration-btn").addEventListener("click", startCalibration);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        attack();
      }
    });
    resetBattle();
    resetDiagnostics();
    loadCalibration();
  }

  // 弱点ねらい(マーカー攻撃)用: タップの「最寄り四分音符」に対する時間判定を外部へ公開。
  // 空間判定(弱点位置)はフロー側で行い、これは時間判定のみ(厳しめ窓)を返す。
  window.RhythmAttack = {
    setMarkerMode: function (on) { SETTINGS.markerAttackMode = !!on; },
    tapNote: function (event) { attack(event); }, // 防御: レーン内どこでもタップ→ノーツ判定
    judgeBeatTap: function (event) {
      if (!state.running || state.countingIn) return { valid: false, rank: "miss", offsetMs: null, beatIndex: -1 };
      const beat = beatSeconds(SETTINGS.bpm);
      const now = inputSongTime(event);
      const beatIndex = Math.round(now / beat);
      if (beatIndex < 0) return { valid: false, rank: "miss", offsetMs: null, beatIndex: -1 };
      const offsetMs = (now - beatIndex * beat) * 1000;
      const j = judgeHit(offsetMs, { perfectMs: SETTINGS.attackPerfectMs, goodMs: SETTINGS.attackGoodMs });
      return { valid: true, rank: j.rank, offsetMs: offsetMs, beatIndex: beatIndex };
    },
  };

  window.addEventListener("DOMContentLoaded", bind);
}());
