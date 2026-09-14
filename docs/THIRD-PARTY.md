# 第三者の素材と権利の確認

確認日：2026-09-15。このリポジトリ（公開）と、GitHub Pages で配信しているアプリ（`public/` のみ）に含まれる第三者の素材を、配信元の表示で確認した結果。法律上の助言ではない。

## 公開リポジトリに含まれるもの

### JVNV コーパスに由来するメタデータ

- 対象ファイル：`docs/emotion-lab-results.json`、`docs/emotion-lab-rule-results.json`、`docs/EMOTION-VALIDATION.md`、`docs/EMOTION-RULE-MODEL.md` の結果表
- ライセンス：**CC BY-SA 4.0**。[公式ページ](https://sites.google.com/site/shinnosuketakamichi/research-topics/jvnv_corpus)の表示で確認。商用・非商用の利用、再配布、改変が可能。条件は帰属表示、変更の明示、改変物を同じライセンスで共有すること。
- 含むもの：公開順の行番号、話者ID（F1・F2・M1・M2）、コーパスの感情ラベル、収録セッション種別、音声ファイルの SHA-256、本プロジェクトで計算した測定値。
- **含まないもの：音声そのもの、音声の書き起こし・台詞文、加工した音声。** 音声は検証時にメモリ上でのみ扱い、保存・同梱・再配布していない。
- 行った変更：中央3秒の切り出し、モノラル化、分類器の検証では16 kHzへの変換と正規化。これらは測定のための処理で、変更後の音声は配布していない。
- 上記の結果ファイルは、JVNV に由来する部分を含むため、慎重を期して **CC BY-SA 4.0** で提供する扱いとする。本リポジトリのアプリのコードには及ばない。
- 帰属表示：Detai Xin, Junfeng Jiang, Shinnosuke Takamichi, Yuki Saito, Akiko Aizawa, Hiroshi Saruwatari, "JVNV: A Corpus of Japanese Emotional Speech with Verbal Content and Nonverbal Expressions," arXiv:2310.06072, 2023. ライセンス：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。
- 取得経路の注意：検証スクリプトは Hugging Face 上のミラー `asahi417/jvnv-emotional-speech-corpus` から取得している。**このミラーのデータセットカードにはライセンス表示も帰属表示もない**（2026-09-15 確認）。ミラーは原著者による配布ではないため、権利関係は上記の公式表示に従うものとして扱う。今後の再検証では公式配布元からの取得も検討する。

### GeMAPS の特徴量定義

- 出典：F. Eyben ほか, "The Geneva Minimalistic Acoustic Parameter Set (GeMAPS) for Voice Research and Affective Computing," IEEE Transactions on Affective Computing, 7(2), 2016。採録版PDFに **CC BY 3.0** の表示。
- 使い方：定義（周波数帯域、窓長など）を読み、本リポジトリで新規にコードを書いた。論文の文章・図表・コードは複製していない。帰属は `public/spectrum.js` と `docs/EMOTION-RULE-MODEL.md` に記載。

### 引用

`docs/` 内のライセンス文（openSMILE の使用許諾など）は、判断の根拠を示すための短い引用に限っている。出典を併記している。

## 公開リポジトリに含まれないもの

| 素材 | ライセンス | 扱い |
| --- | --- | --- |
| wav2vec2 感情分類モデル（ONNX, 約90 MB） | モデルカードに MIT 表記 | `.model-lab/` に置き、`.gitignore` で除外。公開していない |
| ONNX Runtime Web（WASM） | MIT | 同上。`package-lock.json` に名前と版が載るだけ |
| openSMILE | audEERING Research License（非商用限定） | 使用も同梱もしていない |
| Praat | GPLv3 以降 | 使用も同梱もしていない |
| JVNV の音声 | CC BY-SA 4.0 | 同梱していない |

公開前に `git ls-files` で、モデル、WASM、音声、証明書、秘密鍵が追跡対象にないことを確認した。

## その他

- アイコン：`scripts/generate-icons.mjs` で生成した自作のもの。
- `docs/preview.png`・`docs/presentation.png`：本アプリの画面の撮影。
- GitHub Actions の公式アクション（`actions/*`）：MIT。CI で実行するだけで、配布物には含まれない。
- 外部フォント、外部CDN、画像素材は使っていない。
- **このリポジトリには LICENSE ファイルがない。** そのため、アプリのコードは作者の許可なく再利用できない状態（著作権の標準的な扱い）になっている。他の人に使ってもらう予定があるなら、ライセンスを選んで追加する必要がある。
