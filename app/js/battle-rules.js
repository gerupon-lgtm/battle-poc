// =====================================================
// battle-rules.js -- 連続案(combo)の純粋ルール(ダメージ計算・上限・結果検証)。
//   DOM/音声/状態に一切依存しない純粋関数のみ。
//   「クライアントの表示」と「将来のサーバ再計算」が同一の式を共有するための単一の真実。
//   Node からも window 無しで利用可(module.exports と window 両対応)。
//   ※ ここを変えるとバランスが変わる。本体結線時はサーバ側もこの式を移植/共有すること。
// =====================================================
(function (root) {
  "use strict";

  // 攻撃: 1ターンの累積ダメージ。perfect=重み1, good=goodWeight, クイズ正解(buffed)で倍率。
  //   combo の per-hit 累積(各ヒットで floor して差分適用)の総量と一致する:
  //   floor(attackMaxPerTurn * mult * (perfect + good*goodWeight) / (attackBars*4))。
  function computeAttackDamage(perfect, good, buffed, p) {
    const beats = (p.attackBars || 4) * 4;
    const mult = buffed ? (p.quizBuffMult != null ? p.quizBuffMult : 1) : 1;
    const gw = (p.goodWeight != null ? p.goodWeight : 0.5);
    const weighted = (perfect || 0) + (good || 0) * gw;
    return Math.floor((p.attackMaxPerTurn || 0) * mult * weighted / beats);
  }

  // 防御: 被弾Miss数 × 1Missダメージ。
  function computeDefenseDamage(defMisses, p) {
    return (defMisses || 0) * (p.defenseMissDamage || 0);
  }

  // 連打ペナルティの自傷: penalties × penaltyDamage。
  function computePenaltyDamage(penalties, p) {
    return (penalties || 0) * (p.penaltyDamage || 0);
  }

  // 1ターンの最大攻撃ヒット数(上限の基準)。
  function maxAttackHits(p) { return (p.attackBars || 4) * 4; }

  // 構造化結果(Step3 の result)をサーバ視点で再計算/検証する。
  //   - 各setの perfect+good を上限(maxAttackHits)でクランプ
  //   - ダメージをルール式で再計算(クライアント申告 damageDealt/Taken は信用しない)
  //   - bounds 指定時は elapsedMs の時間整合も確認
  //   返り値: { valid, flags[], authoritative:{ damageDealt, damageTaken, perSet[] }, totals }
  function validateResult(result, p, bounds) {
    const flags = [];
    const perSet = [];
    let dealt = 0, taken = 0;
    const maxHits = maxAttackHits(p);
    const sets = (result && result.sets) || [];
    sets.forEach(function (s, i) {
      let perfect = Math.max(0, s.atk ? (s.atk.perfect || 0) : 0);
      let good = Math.max(0, s.atk ? (s.atk.good || 0) : 0);
      if (perfect + good > maxHits) {
        flags.push("set" + i + ": ヒット数が上限超過(" + (perfect + good) + ">" + maxHits + ")→クランプ");
        perfect = Math.min(perfect, maxHits);
        good = Math.min(good, maxHits - perfect);
      }
      const d = computeAttackDamage(perfect, good, !!s.quizCorrect, p);
      const t = computeDefenseDamage(s.defMisses, p) + computePenaltyDamage(s.penalties, p);
      if (s.damageDealt != null && s.damageDealt !== d) flags.push("set" + i + ": 与ダメ申告" + s.damageDealt + "≠再計算" + d);
      if (s.damageTaken != null && s.damageTaken !== t) flags.push("set" + i + ": 被ダメ申告" + s.damageTaken + "≠再計算" + t);
      perSet.push({ damageDealt: d, damageTaken: t, perfect: perfect, good: good });
      dealt += d; taken += t;
    });
    if (bounds && result && typeof result.elapsedMs === "number") {
      const n = sets.length || 1;
      if (bounds.minMsPerSet != null && result.elapsedMs < bounds.minMsPerSet * n)
        flags.push("elapsedMs が短すぎる(" + result.elapsedMs + "<" + (bounds.minMsPerSet * n) + ")");
      if (bounds.maxMsPerSet != null && result.elapsedMs > bounds.maxMsPerSet * n)
        flags.push("elapsedMs が長すぎる(" + result.elapsedMs + ">" + (bounds.maxMsPerSet * n) + ")");
    }
    return {
      valid: flags.length === 0,
      flags: flags,
      authoritative: { damageDealt: dealt, damageTaken: taken, perSet: perSet },
      totals: { damageDealt: dealt, damageTaken: taken },
    };
  }

  // CONFIG(battle-combo.js) から rules params を生成。
  function paramsFromConfig(c) {
    return {
      attackMaxPerTurn: c.ATTACK_MAX_PER_TURN,
      goodWeight: c.GOOD_WEIGHT,
      quizBuffMult: c.QUIZ_BUFF_MULT,
      attackBars: c.ATTACK_BARS,
      defenseBars: c.DEFENSE_BARS,
      defenseMissDamage: c.DEFENSE_MISS_DAMAGE,
      penaltyDamage: c.PENALTY_DAMAGE,
    };
  }

  const api = {
    computeAttackDamage: computeAttackDamage,
    computeDefenseDamage: computeDefenseDamage,
    computePenaltyDamage: computePenaltyDamage,
    maxAttackHits: maxAttackHits,
    validateResult: validateResult,
    paramsFromConfig: paramsFromConfig,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BattleRules = api;
})(typeof window !== "undefined" ? window : null);
