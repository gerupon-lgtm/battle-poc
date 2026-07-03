// =====================================================
// battle-client.js -- combo と「サーバ」の境界(BattleClient)。
//   本体結線フェーズでは、この境界を実サーバ実装(POST /battles/start, /result)に
//   差し替えるだけでよい。ここでは PoC 用の **インメモリ・モックサーバ** を提供し、
//   client↔server の契約(セッション・冪等・時間整合・サーバ確定値)を実機サーバ無しで実証する。
//
//   インタフェース:
//     start(req)                         -> Promise<{ sessionId, nonce, enemy, playerHp, params }>
//     submitResult({ sessionId, nonce, result })
//                                        -> Promise<{ accepted, outcome?, enemyHp?, playerHp?, authoritative?, valid?, flags, reason? }>
//   result は battle-combo の構造化結果(Step3): { outcome, elapsedMs, sets[], totals }。
//   サーバはクライアントの damageDealt/Taken を信用せず、BattleRules で再計算/クランプして確定する。
// =====================================================
(function (root) {
  "use strict";

  function getRules(opts) {
    if (opts && opts.rules) return opts.rules;
    if (root && root.BattleRules) return root.BattleRules;
    if (typeof require !== "undefined") { try { return require("./battle-rules.js"); } catch (_) {} }
    return null;
  }
  function rnd() { return Math.random().toString(36).slice(2, 10); }

  // インメモリ・モックサーバ。
  //   opts: { params(ルールparams), enemy:{name,hp}, playerHp, bounds:{minMsPerSet,maxMsPerSet}, rules }
  function createMock(opts) {
    opts = opts || {};
    const Rules = getRules(opts);
    const params = opts.params;
    const enemy = opts.enemy || { name: "Mock", hp: 100 };
    const playerHp0 = opts.playerHp != null ? opts.playerHp : 100;
    const bounds = opts.bounds || { minMsPerSet: 1000, maxMsPerSet: 120000 };
    const sessions = {};
    let seq = 0;

    return {
      start: function (req) {
        const sessionId = "s" + (++seq) + "_" + rnd();
        const nonce = rnd();
        sessions[sessionId] = { nonce: nonce, used: false, startedAt: Date.now() };
        return Promise.resolve({
          sessionId: sessionId,
          nonce: nonce,
          enemy: { name: enemy.name, hp: enemy.hp },
          playerHp: playerHp0,
          params: params,
        });
      },

      submitResult: function (payload) {
        payload = payload || {};
        const s = sessions[payload.sessionId];
        if (!s) return Promise.resolve({ accepted: false, reason: "unknown_session", flags: ["unknown session"] });
        if (s.nonce !== payload.nonce) return Promise.resolve({ accepted: false, reason: "bad_nonce", flags: ["nonce mismatch"] });
        if (s.used) return Promise.resolve({ accepted: false, reason: "already_submitted", flags: ["duplicate submit"] });

        const result = payload.result || {};
        const n = (result.sets && result.sets.length) || 1;
        // 時間整合(範囲外は拒否)。1セッション1結果なので、ここで消費しておく。
        if (typeof result.elapsedMs === "number") {
          if (result.elapsedMs < bounds.minMsPerSet * n || result.elapsedMs > bounds.maxMsPerSet * n) {
            s.used = true;
            return Promise.resolve({ accepted: false, reason: "time_out_of_range",
              flags: ["elapsedMs out of range: " + result.elapsedMs] });
          }
        }
        // ダメージはサーバ側で再計算/クランプ(クライアント申告は信用しない)。
        const v = Rules.validateResult(result, params);
        s.used = true;
        const enemyHp = enemy.hp - v.authoritative.damageDealt;
        const playerHp = playerHp0 - v.authoritative.damageTaken;
        const outcome = enemyHp <= 0 ? "win" : (playerHp <= 0 ? "lose" : "draw");
        return Promise.resolve({
          accepted: true,
          outcome: outcome,
          enemyHp: enemyHp,
          playerHp: playerHp,
          authoritative: v.authoritative,
          valid: v.valid,
          flags: v.flags,
        });
      },
    };
  }

  const api = { createMock: createMock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BattleClient = api;
})(typeof window !== "undefined" ? window : null);
