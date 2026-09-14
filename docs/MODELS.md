# audEERINGモデル候補と導入判断

2026-09-13追記：感情ラベルを出すモデルとaudEERINGの軽量モデルを含む[追加候補の比較](EMOTION-CANDIDATES.md)を作成。以下は初回候補の調査記録。現在もモデル未導入。

確認日：2026-09-12。公式モデルカード・配布サイト・ランタイムの資料を確認。モデル本体のダウンロード・推論は未実施。

## 主候補

**audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim**

| 項目 | 確認内容 |
| --- | --- |
| 提供元 | audEERING GmbH |
| 内容 | Wav2Vec2-Large-Robustを12層に削減しMSP-Podcast v1.7で微調整 |
| 入力 | 生の音声信号。モデルカードの例は16 kHz、processorで正規化 |
| 出力 | arousal / dominance / valenceの回帰値（概ね0〜1）と特徴ベクトル |
| Hugging Face配布 | PyTorch / Safetensors。各重みファイルは約661 MB |
| 公式ONNX | Zenodo DOI:10.5281/zenodo.6221127、版1.1.0。ZIP表示サイズ609.9 MB |
| 現在のアプリ | 未導入。感情推定なし。モデル取得ボタンや外部推論APIなし |

出典：[公式モデルカード](https://huggingface.co/audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim)、[ファイル一覧](https://huggingface.co/audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim/tree/main)、[公式ONNX配布](https://zenodo.org/records/6221127)、[公式利用例](https://github.com/audeering/w2v2-how-to)。

出力の3値は演技力・魅力度・合否・感情クラスの確率ではありません。モデルカードの例にある数値を画面の初期値に流用してはいけません。日本語の演技音声・ささやき・叫び声について、この調査で妥当性は確認できていません。

## 無料・非商用の条件

モデルのライセンス欄およびLICENSE本文は **CC BY-NC-SA 4.0** です。非商用で、ライセンスの条件に従う利用についてロイヤルティ不要の許諾が記載されています。ただしモデルカードには別途 **“for research purpose only”** という記載があります。「公開済み」「無料ダウンロード可能」だけで本用途の利用許可が確定するわけではありません。

[配布元LICENSE全文](https://huggingface.co/audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim/blob/main/LICENSE)、[CCの日本語要約](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ja)、[CC条文](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en)。

導入・再配布時に守る事項：

- 作者・指定帰属先、既存の著作権表示、ライセンス・免責の告知、元資料へのリンクを保持する。
- CC BY-NC-SA 4.0の名称と本文またはリンクを示す。オフラインで読めるように採用版のLICENSE全文も同梱する。
- 非商用に限る。非商用は主として商業上の利得・金銭的報酬を目的としない利用を指し、参加料やアプリ価格が無料というだけでは決まらない。
- 変更した場合は変更内容と従前の変更告知を残す。改変物を共有する場合は同一または互換ライセンスの継承条件を確認する。単なる形式変換と改変の扱いはLICENSE本文も確認する。
- ライセンスで許された利用を追加の法的・技術的制限で妨げない。作者による推奨を示唆しない。
- アプリ全体が自動的に同ライセンスになるとは断定しない。配布形態ごとに対象を整理する。

**判断：オーディションでの自己アピール（就業・営業につながる用途）が非商用・研究目的に該当するか未確定のため、モデル採用は保留。** audEERINGに用途・無償提供の範囲・モデル同梱配布・ONNX/量子化の予定を示して確認する必要があります。問い合わせ送信は行っていません。CC本文とモデルカードの追加表記の法的関係を独自に断定せず、実利用の可否を権利者に確認する判断です。

学術ライセンス製品も自動的に無料ではありません。[audEERINGの学術プログラム](https://www.audeering.com/academic-license-request-form/)は学術・非商用向けの割引価格を案内しています。公開モデルのCC許諾とdevAIceなどの製品契約を混同しません。

## ブラウザ実行への対応

公式ONNX版があるので、ONNX Runtime Webを使った**技術検証の経路はあります**。ONNX Runtime Webの対応表ではWebAssembly CPUがSafari iOSに対応しています。しかしランタイムがSafariに対応することと、このモデルが対象iPadで実行できることは別です。公式資料でこのモデルのiPad向け動作保証・速度の実測値は確認できませんでした。[ONNX Runtime Webの公式対応表](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)

数百MBのモデルは、ダウンロードサイズ以外に展開後の重み・テンソル・作業領域のメモリを要します。iPadのモデルごとに読み込み失敗、タブの強制終了、発熱、遅延の確認が必要です。公式資料にはWebAssemblyのメモリ上限なども記載されています。ZIPの大きさを必要メモリと見なしてはいけません。[大規模モデルの公式説明](https://onnxruntime.ai/docs/tutorials/web/large-models.html)

初回検証はWebAssembly CPU・単一スレッドを基準にし、WebGPUやSharedArrayBuffer必須の構成を前提にしません。将来のランタイム導入時はJS/WASM/モデルを同一オリジンから配り、外部CDNを使わない設定を明示します。WASMのパスやWorker、CSPの変更も必要になり得ます。[公式デプロイ手順](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

## 次段階の導入ゲート

1. 上記用途・配布条件の確認を記録する。実際の採用版ZIPのLICENSE・モデル設定・帰属情報も照合する。
2. 配布元URL・バージョン・SHA-256・ファイルサイズ・ライセンスを固定した資産台帳を作る。必要ならWindows上で変換し、モデル重みと実行ライブラリをローカル配布する。
3. ONNXの入力名・型・shape・opset・出力順・正規化がグラフ内か外かを実ファイルで確認する。ここはまだ未確認。HFのPython用processor処理をONNXに二重適用しない。
4. iPadの実際の入力レートから16 kHzモノラルへの適切なリサンプリング、音声窓・正規化を実装する。現在のHz表示用の簡易間引きをモデル入力に流用しない。
5. Windowsで公開モデルの参照出力とブラウザ出力を比較する。テストには合成入力や利用許諾のある非ユーザー音声を使い、実ユーザーの声を保存しない。
6. Web Worker内の単一推論キューで処理し、古い音声窓を貯めない。停止・非表示でWorkerも破棄し、音声バッファを解放する。
7. 対象iPadで読み込み時間・推論時間・メモリ・温度・バッテリー・オフライン再起動を検証。許容性能に達しなければ未導入状態を維持する。
8. 実際の推論が成功した出力だけ表示する。未ロード／ロード失敗／未検出／処理中を区別し、無音時や失敗時にダミースコアへ切り替えない。

## 関連技術を同一扱いにしない

openSMILEは主に音響特徴抽出ツールで、この公開済み感情モデルとは別です。openSMILEの無料版には商用製品利用の制限があります。代替導入する場合も個別確認が必要です。今回のRMS／基本周波数計測は自作JavaScriptで、openSMILEを利用していません。[openSMILE公式ライセンス説明](https://audeering.github.io/opensmile/about.html)
