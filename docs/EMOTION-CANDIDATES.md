# 声の感情推定モデルの追加候補

調査日：2026-09-13。目的は、日本語の演じ分けに応じて本番の画面を変化させること。
以下は当初の公開資料に基づく候補比較。本番アプリには感情モデルを導入していない。

**2026-09-13 14:46 JST 追記：** 学習済みモデルを使わない代替として、規則ベースの「声の四つの尺度」を実装・導入した。特徴量の定義はGeMAPS（CC BY 3.0）に基づき自前実装し、非商用限定のopenSMILEとGPLのPraatは使用していない。[定義・権利確認・検証結果](EMOTION-RULE-MODEL.md)。下表の学習済みモデル候補は、この規則ベース方式と比較する対象として残す。日本語公開音声での両者の比較は未実施。

**2026-09-13検証追記：** ONNX版wav2vec2の4ビット量子化モデルを別の開発環境で実際に動かした。日本語の公開音声24例（中央3秒）の一致は7/24、Windowsで推論約2秒。現構成の本番採用は見送る。[検証方法・結果・プライバシー確認の範囲](EMOTION-VALIDATION.md)。他の候補の推論とiPad実機は未検証。

## 比較

**全候補の必須条件：利用者の声を学習に使わない。** 公開済みモデルを端末内に置き、固定された重みで推論だけを行う構成に限定する。追加学習・微調整・個人適応・声の複製・学習用データ収集は端末内でも行わない。クラウドAPIや外部デモでの試用は候補に含めない。

下表は配布モデルの候補であり、同名のオンラインサービスの利用を勧めるものではない。各候補の採用前に、実装・依存ライブラリの送信／保存／学習処理の有無、固定重みの使用、オフライン動作を検証する。この確認ができない構成は採用しない。

| 候補 | 実際に推定するもの | ブラウザ実行の経路・サイズ | 日本語・用途の制約 |
| --- | --- | --- | --- |
| SenseVoice Small | 喜び・怒り・悲しみなどの感情ラベル。音声認識・音イベント認識も持つ | ONNXへの書き出しに対応。sherpa-onnx配布の量子化モデルは239 MB。WebAssemblyで検証する経路がある | 日本語を含む5言語対応。ただし公式の感情評価は中国語・英語で、日本語の感情精度を保証するものではない。独自ライセンスの用途確認が必要 |
| onnx-community/wav2vec2-emotion-recognition-ONNX | 喜び・怒り・悲しみ・驚き・恐れ・嫌悪・中立の7分類 | ONNX配布とTransformers.jsの利用例あり。今回、この配布版の各ファイルサイズは未確認 | 英語のモデル。日本語の演技で使えるか比較が必要。元モデル・変換版のカードはMIT表記 |
| emotion2vec+ base | 怒り・嫌悪・恐れ・喜び・中立・悲しみ・驚きに、その他・不明を加えた9分類 | 公式配布のmodel.ptは1.12 GB。ブラウザ用への変換・軽量化・出力検証が必要 | 日本語の演技に対する精度は未確認。独自ライセンス。iPad向けの初回候補としては重い |
| audEERING Wav2Small 2.0 | arousal・dominance・valenceの3軸。感情の活性度、支配性、快・不快に相当 | 配布重みmodel.safetensorsは68.7 kB。現在の配布はPyTorch利用例で、ONNX変換・一致確認が必要 | 喜怒哀楽の分類器ではない。日本語の妥当性は未確認。CC BY-NC-SA 4.0と研究目的の表記あり |

ファイルサイズは保存時のモデル重みの大きさで、必要メモリやアプリ全体のサイズではない。軽量でも精度・速度が十分とは限らない。公開モデルを端末内で実行する構成を検討しており、公開デモにユーザーの声を送って試すことはしない。

出典：

- SenseVoice：[公式モデルカード](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)、[公式リポジトリ](https://github.com/QwenAudio/SenseVoice)、[sherpa-onnxの配布ファイル](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/main)、[sherpa-onnx変更履歴](https://github.com/k2-fsa/sherpa-onnx/blob/master/CHANGELOG.md)。ブラウザ側で感情ラベルを取得できるかも実装検証が必要。
- wav2vec2：[ONNX版・JavaScript利用例](https://huggingface.co/onnx-community/wav2vec2-emotion-recognition-ONNX)、[元モデル](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition)。カードの検証精度を、日本語・本アプリの精度として流用しない。
- emotion2vec+：[公式モデルカード](https://huggingface.co/emotion2vec/emotion2vec_plus_base)、[配布ファイル](https://huggingface.co/emotion2vec/emotion2vec_plus_base/tree/main)。その他・不明を含むため「9種類の感情」とは表示しない。
- Wav2Small：[公式モデルカード](https://huggingface.co/audeering/wav2small)、[配布ファイル](https://huggingface.co/audeering/wav2small/tree/main)。旧論文のモデルと現在の2.0のサイズ・形式を混同しない。

## 無料利用と必要な表示

SenseVoiceとemotion2vec+のモデルカードは独自のFunASRモデルライセンスを指定する。確認時点の[MODEL_LICENSE](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)はv1.1で、利用・複製・変更・共有に関する許諾のほか、出典・作者・モデル名の保持、参考・学習目的という記載、その他の条件がある。コード側のMITやApacheライセンスをモデルに適用してはいけない。オーディション本番での利用・同梱配布の可否は確定していない。採用時に対象版と適用条項を固定・照合し、必要な用途確認を行う。

wav2vec2候補は元モデル・ONNX版ともモデルカードにMIT表記がある。採用するファイルのライセンスと由来を照合し、著作権表示・許諾文・免責文を保持してオフラインでも読めるようにする。カードのタグだけで全同梱資産の条件確認が終わったとは扱わない。

Wav2Smallは[CC BY-NC-SA 4.0](https://huggingface.co/audeering/wav2small/blob/main/LICENSE)で、モデルカードには研究目的限定の記載もある。帰属、ライセンス、変更告知を残し、非商用・改変物共有時の継承条件を確認する。オーディションが無料参加でも非商用とは断定しない。詳細な確認方針は[既存のモデル調査](MODELS.md)も参照。

## 推奨する進め方

2026-09-13の追加確認：[公開背景・利用実績・問題の調査](MODEL-PROVENANCE.md)。ONNX版wav2vec2はブラウザでの比較実験候補であり、本番利用の信頼性が確認された推奨モデルではない。利用例、ダウンロード数、MIT表記だけで採用を確定しない。

日本語を扱う候補としてSenseVoice Small、ブラウザへの組み込み経路が明示された比較候補としてONNX版wav2vec2を選ぶ。ただし、これは採用決定ではない。前者は用途条件、後者は日本語への適合が大きな未解決点。emotion2vec+は比較対象、Wav2Smallは3軸の感情表現を選ぶ場合の候補とする。

1. 採用版の利用・配布条件を確認し、モデルとランタイムをアプリ資産として同梱する。外部モデル取得・CDNを無効にする。
   推論専用であることをコードと依存ライブラリから確認する。音声取得開始から停止まで、入力由来データの通信・永続化がないことを検証する。精度が不十分でも、利用者の声による追加学習や外部送信へ切り替えない。
2. Windowsのブラウザで、同じ日本語の台詞を喜び・怒り・悲しみ・普通の調子で発声して比較する。音声は解析に必要な短時間だけメモリに保持し、保存も送信もしない。
3. 台詞を変えても声の演じ分けに反応するか、無音・雑音に誤反応しないかを確認する。想定した演技と推定ラベルが一致しないことも隠さない。
4. iPadで読み込み時間、発声から表示までの遅れ、発熱、連続動作、オフライン起動を確認する。使う音声窓の長さは実測で決め、瞬時の推定を約束しない。
5. 実推論の結果だけを「声から推定した表現」として表示する。本人の内心や演技力・合否の判定にはしない。モデル未ロード・失敗・無音は明示し、ダミーの感情へ切り替えない。

[ONNX Runtime Webの対応表](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)にはSafari iOS向けWebAssembly対応があるが、個別モデルの動作・速度保証ではない。[Transformers.jsのローカル資産設定](https://huggingface.co/docs/transformers.js/en/custom_usage)も導入時に確認する。
