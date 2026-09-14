# 感情モデルのローカル実行検証

実施日：2026-09-13。**ブラウザ内の実推論は成功。ただし今回の日本語の小規模試験では一致が7/24にとどまり、この構成をそのまま本番採用することは勧めない。**

これは公開済み音声だけを使った開発検証。利用者の声・マイクは使用していない。本番アプリの表示とマイク処理には変更を加えておらず、感情モデルは本番アプリには未導入。

## 実際に動かした構成

- モデル：`onnx-community/wav2vec2-emotion-recognition-ONNX` の `model_q4.onnx`（4ビット量子化版）。[配布元](https://huggingface.co/onnx-community/wav2vec2-emotion-recognition-ONNX)
- 採用リビジョン：`8e0e66145d3a67fb99291f7834d35f073581114b`。
- 重み：89,860,722 bytes。SHA-256：`363653a4bce950ddd17026efdabdf6c7a6843e00089bcbaf424c0cdf0b6ebff2`。配布元LFSの照合値と一致。
- ランタイム：ONNX Runtime Web 1.29.0、WebAssembly CPU、1スレッド。学習用WASMは使っていない。[公式の推論／学習用資産の区別](https://onnxruntime.ai/docs/tutorials/web/deploy.html)
- 環境：Windows、Chrome 152.0.7977.83、Intel Core i5-10400 @ 2.90 GHz。
- 入力：16 kHzモノラル。ブラウザのOfflineAudioContextでリサンプリングし、配布設定に合わせて平均・分散による正規化。単一音声、paddingなし、attention maskなし。
- 実グラフの入力名は `input_values`、出力名は `logits`。7個の有限値を返すことを確認。
- 説明文では中立とされる分類が、実際の `config.json` のindex 1では `calm`。今回の記録は実ファイルのラベルを採用し、説明文に合わせて黙って置き換えていない。

## 日本語の検証方法

[JVNVコーパスの公式説明](https://sites.google.com/site/shinnosuketakamichi/research-topics/jvnv_corpus)と[公開ミラー](https://huggingface.co/datasets/asahi417/jvnv-emotional-speech-corpus)を使用。ミラーのリビジョンは `3b6c3794754e9e514766e898f69604a0f7417218`。

4話者（F1・F2・M1・M2）×6感情から、公開順で最初の1件ずつ、計24件を推論前に選んだ。結果を見て音声を選び直していない。各音声の中央3秒を解析した。音声には笑い・泣きなどの非言語表現も含まれる。短い窓で反応する用途の初期確認で、全文を聞く条件ではない。

公開ミラーからの音声取得は開発用Nodeプロセスのメモリ内のみ。音声ファイルは保存せず、ローカルのブラウザ検証プロトコルで専用ページへ渡した。ユーザー音声の入力口・アップロードAPIは設けていない。

## 結果

| コーパスで指定された感情 | 一致した数 | 実際の推定の傾向 |
| --- | --- | --- |
| 喜び | 4/4 | 4例ともhappy |
| 恐れ | 3/4 | fearfulが3例、happyが1例 |
| 悲しみ | 0/4 | 4例ともfearful |
| 怒り | 0/4 | fearfulが1例、happyが2例、surprisedが1例 |
| 驚き | 0/4 | fearfulが3例、happyが1例 |
| 嫌悪 | 0/4 | fearfulが2例、happyが1例、surprisedが1例 |
| 合計 | **7/24** | この24件・中央3秒・量子化版に限る一致数 |

モデル読み込みはローカル配信で約1.11秒。日本語24件の推論時間は最短約1.98秒、中央値約2.03秒、最長約2.62秒。音声3秒を集める時間、デコード・リサンプリング時間は推論時間に含めていない。初回のインターネットからのモデル取得時間やiPadの速度でもない。

無音、220 Hzの単純な正弦波、固定乱数の雑音を各3秒入力する対照試験では、いずれも `sad` を返した。これは音声がなくても分類器が何らかのラベルを返す実例で、「悲しみを正しく検出した」とは扱わない。実用時には無音・発声なし・判断できない入力を扱う別の処理が必要。単に一番大きい出力を感情として表示しない。

同一の単純音を2回入力した出力は完全一致した。この事実だけを追加学習がないことの証明にはせず、推論専用コード・使用するWASM・固定モデル構成と併せて確認している。

## プライバシーについて確認した範囲

- マイクはPermissions-Policyで禁止し、呼び出しもなかった。
- モデル・実行部品の読み込みは専用ローカルサーバーの固定資産GETのみ（8件）。外部URLや送信要求はブラウザ検証側の許可リストでも拒否する構成。
- **全推論の前にブラウザのネットワークをオフラインへ切り替え、推論中のページからの通信要求は0件。** 開発用プロセスが公開音声を取得する工程は、この前に完了している。
- Cookie・LocalStorage・SessionStorage・IndexedDB・Cache Storageへの永続化なし。代表的な書き込みAPIの監視でも試行0件。
- 学習処理、optimizer、個人適応、声のプロファイル作成は実装していない。固定モデルに対する `InferenceSession.run` のみ。
- 音声配列は処理後にゼロクリアし、ブラウザと推論セッションは終了する。音声のファイル化は行わない。公開テスト音声のラベル・数値・時間・ハッシュのみ、再確認用の報告として保存する。

これらはこの検証用構成の確認であり、OSやブラウザ全体の通信・完全なメモリ消去・ライブラリの全脆弱性を監査したという意味ではない。本番のマイク入力を含むアプリへの統合検証も未実施。

## 結論と未確認事項

公開モデルをローカルブラウザで実行できることと、今回の検証中に音声を外部へ送信・保存・追加学習しない構成を確認できた。一方で、**本用途に必要な日本語の演じ分けと即応性が十分という証拠は得られなかったため、本番への組み込みは見送る。**

24例は少なく無作為抽出でもない。7/24を日本語全般の正解率と呼ばない。感情ラベルは元音声全体への指定で、切り出した3秒の人による再評価は行っていない。英語向けモデル、日本語との差、量子化、窓の長さ、前処理の影響を分離していない。PyTorch参照実装との数値一致、量子化していない版との比較、iPad実機動作は未検証。

次に比較するモデルでも、利用者の声を学習させる方法には切り替えない。まず同じ公開音声と選定条件で別候補を比較し、本番で見せる価値のある結果が得られるかを確かめる。

## 再実行手順（Windows・開発者用）

通常のアプリの起動には影響しない。再検証したい場合だけ、このプロジェクトのフォルダーでPowerShellを開いて実行する。

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run lab:prepare
npm.cmd run lab:emotion
```

`lab:prepare` はモデル・推論部品・ライセンス文書を `.model-lab` に用意する。ネット接続が必要。`lab:emotion` は公開コーパスをメモリへ取得し、別の非表示Chromeで推論中のページ通信を切断して試験する。公開データの配信が一時的に失敗する場合は、少数回再試行後にエラーで終了し、仮の結果を作らない。取得後の資産で人工信号だけを再確認するには `npm.cmd run lab:controls` を使う。

開発用の依存部品は `package-lock.json` で固定し、インストール時のスクリプト実行を無効にする。通常の `npm.cmd start` のサーバーは検証モデルや検証ページを配信しない。検証用コードにはユーザーの声を入力する機能がない。

詳細：[24例の実測結果](emotion-lab-results.json)、[人工信号だけの検証結果](emotion-lab-controls.json)。報告中のlogitsはモデルの生出力で、感情の確率や演技力の点数ではない。

## 帰属・ライセンス

- 感情モデル：Deepan Gautam / Dpngtm、ONNX変換：onnx-community。MIT表記を含む採用版モデルカードを `.model-lab/model/README.md` に保持。本番配布に向けた全権利関係の確認が済んだとは扱わない。
- ONNX Runtime：Microsoft Corporation、MIT。バージョン1.29.0のLICENSEとThirdPartyNoticesを `.model-lab/runtime/` に保持。
- JVNV：Detai Xin, Junfeng Jiang, Shinnosuke Takamichi, Yuki Saito, Akiko Aizawa, Hiroshi Saruwatari, “JVNV: A Corpus of Japanese Emotional Speech with Verbal Content and Nonverbal Expressions”。音声のライセンスは[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。原資料は上記公式サイト、取得先ミラーはasahi417。検証で中央3秒の切り出し・16 kHzモノラルへの変換・振幅正規化を行った。原音声も加工音声も同梱・再配布しない。
