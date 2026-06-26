// =====================================================
// quiz-engine.js
// data/hashiken-question-set.json からクイズを出題する。
// 制約:
//   - 出題はランダム
//   - 選択肢を絞る場合も正解は必須、他はランダム抽出
//   - 選択肢の順番もランダム
// 将来的には DB 化予定(本検証では JSON を読み込み)。
// =====================================================
(function () {
  let pool = [];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function load(path) {
    const res = await fetch(path || "./data/hashiken-question-set.json");
    const data = await res.json();
    // 単一選択かつ answer が1つの設問のみ採用
    pool = data.questions.filter(
      (q) => q.type === "single" && Array.isArray(q.answer) && q.answer.length === 1
    );
    return pool.length;
  }

  // choiceCount: 表示する選択肢数(2〜元の選択肢数)。未指定なら全選択肢。
  function next(choiceCount) {
    if (pool.length === 0) throw new Error("クイズが読み込まれていません");
    const q = pool[Math.floor(Math.random() * pool.length)];
    const correctIdx = q.answer[0];
    const correctText = q.choices[correctIdx];
    // 空(空文字/空白のみ/null)の選択肢は誤答候補から除外する(データに空欄が混在するため)
    const distractors = q.choices.filter(
      (c, i) => i !== correctIdx && c != null && String(c).trim() !== ""
    );
    const maxChoices = distractors.length + 1; // 正解＋有効な誤答数

    let n = choiceCount || maxChoices;
    n = Math.min(Math.max(2, n), maxChoices); // 有効な選択肢数を超えない

    const pickedWrong = shuffle(distractors).slice(0, n - 1);
    const choices = shuffle([
      { text: correctText, correct: true },
      ...pickedWrong.map((t) => ({ text: t, correct: false })),
    ]);

    return {
      id: q.id,
      category: q.category,
      question: q.question,
      explanation: q.explanation,
      choiceCount: choices.length,
      choices: choices,
    };
  }

  window.QuizEngine = { load, next, _size: () => pool.length };
})();
