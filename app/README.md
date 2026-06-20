# バトル方式 検証 PoC（self-contained）

`index.html` のターン制バトルUIと `rhythm-battle-poc.html` のリズム機構を流用し、
「はしけん」クイズと組み合わせた **2 案のバトルフロー** を検証するための独立フォルダです。

- **既存システムには一切手を加えていません。** すべてこの `app/` 配下で完結します。
- そのまま GitHub の別リポジトリへ push して動作させられる構成です（リポジトリ内だけで完結）。

## フォルダ構成
```
app/
├── index.html          方式選択ランディング
├── tantan.html         たんたん案
├── toshi.html          トシ案(改)
├── css/
│   ├── rhythm-battle-poc.css   (元POCからコピー)
│   └── battle-verify.css       (検証レイヤー)
├── js/
│   ├── rhythm-battle-poc.js    (元POPをコピー＋ラウンド終了フックを追加)
│   ├── enemy-loader.js         enemies.csv 読込(そらドラゴン固定 enemy_008)
│   ├── quiz-engine.js          クイズ出題(ランダム/正解必須/選択肢シャッフル/絞り込み)
│   ├── battle-core.js          HP・ログ・クイズ描画・リズム実行の共通基盤
│   ├── battle-tantan.js        たんたん案フロー
│   └── battle-toshi.js         トシ案(改)フロー
└── data/
    ├── enemies.csv
    └── hashiken-question-set.json
```

## 起動方法（重要）
`fetch` で CSV / JSON を読むため、**ローカルHTTPサーバ経由**で開いてください
（`file://` 直開きでは読み込みに失敗します）。

```bash
cd app
python3 -m http.server 8000
# → http://localhost:8000/index.html を開く
```
GitHub Pages にそのまま置いても動作します（ルートを `app/` にする）。

## 2 案のフロー

### たんたん案（`tantan.html`）
1. リズムラウンド（既定曲）を演奏 → 獲得スコアで次のクイズの**選択肢数が決まる**（高スコアほど少=易しい）
2. クイズ出題：正解=敵にダメージ／不正解=自分にダメージ
3. 解説は**毎問**その場で表示
4. どちらかの HP が 0 になるまで 1〜3 を繰り返す

### トシ案（改）（`toshi.html`）
ページ上部で**リズムの役割**を選べます（PoC ではトシ案トップで選択）。

**攻撃型（既定）**
1. クイズ窓（2択）：正解=敵の守備力**半減**／不正解=そのまま
2. 防御リズム：クリア=敵にダメージ／時間切れ=自分にダメージ
3. 解説は**勝利後**にまとめて表示（学びの導線）
4. どちらかの HP が 0 になるまで繰り返す

**防御専用**
1. クイズ窓（2択）：正解=敵にダメージ／不正解=敵にダメージなし
2. リズムは**防御専用**：敵の反撃（被ダメージ）を**獲得スコアで軽減**（高得点ほど被害小、十分高ければ無傷）
3. 解説は**勝利後**にまとめて表示
4. どちらかの HP が 0 になるまで繰り返す

## リズム結果の表示タイミング
- リズムラウンドの結果（撃破！／時間切れ・スコア・コンボ）を**表示したまま保持**し、
  ［次へ］を押してから次のターン（クイズ等）へ進みます。
- 二回目以降のリズムラウンド開始時には、**前ターンの結果表示を自動でクリア**します。

## 仕様・制約への対応
- 出題はランダム（`quiz-engine.js`）
- 選択肢を絞る場合も**正解は必須**、他はランダム抽出（`next(choiceCount)`）
- 選択肢の順番もシャッフル
- 敵キャラ固定：そらドラゴン `assets/enemy_dragon.png`（`enemies.csv` の `enemy_008` のプロパティ hp/attack/defense を使用）
- リズムは**既定で選択されている曲**をそのまま使用。プレイ画面・スコア表示・コメント欄（成功/失敗/ダメージ等）を流用
- 現状のターン制バトルのフロントUIイメージ（敵スプライト＋HPバー＋自HPバー＋コメント欄）を残して流用

## 調整パラメータ
各フローの先頭 `CONFIG` で調整できます。
- `battle-tantan.js`：`SCORE_FOR_2_CHOICES` / `SCORE_FOR_3_CHOICES`（選択肢が絞られるスコア境界）、`CORRECT_BASE_DAMAGE`、`CLEAR_BONUS_DAMAGE` など
- `battle-toshi.js`：`QUIZ_CHOICES`（2 or 3）、`PLAYER_ATTACK`、守備半減、`TIMEOUT_*` など

## リズムエンジンへの変更点（最小・追加のみ）
`rhythm-battle-poc.js` のコピーに対し、ラウンド終了時に結果を通知するフックを 2 箇所追加しただけです。
- 撃破（クリア）時：`window.RhythmBridge.onRoundEnd({score, combo, cleared:true})`
- 時間切れ時：`window.RhythmBridge.onRoundEnd({score, combo, cleared:false})`

元の挙動（演奏・採点・表示）はそのまま。`window.RhythmBridge` が無ければ何もしません。

## 将来 DB 化の想定
クイズは本検証では JSON を読み込みますが、将来的には DB 格納予定。
`quiz-engine.js` の `load()`/`next()` のインターフェースを維持したまま、データ取得部のみ差し替え可能です。

## 動作確認状況
- データ層（敵パース・クイズの正解必須/選択肢数/シャッフル）：自動テスト済み
- 各 JS：構文チェック済み、DOM 初期化（jsdom）でエラーなし
- リズム演奏（Web Audio）と全体フローは**ブラウザでの手動確認**が必要です
