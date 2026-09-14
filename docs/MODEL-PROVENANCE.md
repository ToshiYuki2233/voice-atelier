# 候補モデルの公開背景・実績・問題

確認日：2026-09-13。公開資料の調査のみ。音声の入力・送信、モデルの実行、安全性監査は実施していない。

同日追記：その後、利用者の声を使わず公開日本語音声で[ローカル実行検証](EMOTION-VALIDATION.md)を行った。以下は実行前の公開資料調査として残す。

## 配布経路と無料公開の背景

第一の実験候補は、Dpngtm（Deepan Gautam）が公開した感情モデルを、onnx-communityが自動変換・再配布したもの。元の基盤はfacebook/wav2vec2-base-960h。Metaがこの感情分類版の品質を保証しているという意味ではない。[元モデル](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition)、[ONNX配布の説明](https://huggingface.co/onnx-community/wav2vec2-emotion-recognition-ONNX)

作者はコードとデモを公開しているが、無料公開の動機は確認できなかった。研究成果の共有、開発実績の提示、共同改善などは考えられる背景であり、この作者の意図と断定しない。[作者リポジトリ](https://github.com/DGautam11/Speech-Emotion-Recognition)

audEERINGは研究目的の公開モデルと商用ライセンスを案内している。有償利用へつながる提供形態は確認できるが、それだけで無償公開の全動機を説明したとは扱わない。[Wav2Smallモデルカード](https://huggingface.co/audeering/wav2small)

## 確認できた実績と限界

- Dpngtmモデルには作者のデモ実装があり、Hugging Faceには同モデルを使用するSpacesが複数掲載されている。確認時の表示は元モデルが月間約9,000ダウンロード、ONNX版が約90。取得数は利用者数・本番導入数ではない。日本語の声優オーディションやiPadでの安定運用実績は今回確認できなかった。[元モデル](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition)、[ONNX版](https://huggingface.co/onnx-community/wav2vec2-emotion-recognition-ONNX)
- 元モデルの検証精度79.94%は作者の報告で、日本語の精度や第三者の再現結果ではない。英語向け、入力16 kHz、背景雑音による信頼度低下などの制約が明記されている。[モデルカード](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition)
- 元モデルの公開Discussion一覧には、学習ノートブックのリンクにアクセスできないという報告がある。本文取得に失敗したため、詳しい状況・解決状況は未確認。現時点では作者GitHubにnotebooksディレクトリが存在し、「学習手順が非公開」とまでは断定しない。[Discussion一覧](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition/discussions)、[作者GitHub](https://github.com/DGautam11/Speech-Emotion-Recognition)
- SenseVoiceは、VoicePingによる2026-06-26の感情付き合成音声の比較実験で評価器として使用されている。日本語で意図した感情と推定が合わない例も報告された。ただし合成音声の表現不足と認識器の誤りを分離した実験ではなく、人の日本語音声に対するSenseVoiceの正解率としては使えない。[実験実施者の報告](https://voiceping.net/en/blog/research-ja-zh-emotional-tts-benchmark/)

## セキュリティ・権利の扱い

今回の配布ページ・Discussion・公開検索の範囲では、この特定のDpngtmモデル／ONNX変換版について、音声窃取や無断追加学習の具体的な事故報告は確認できなかった。報告が見つからないことは無事故・安全性の証明ではない。Hugging Faceにはマルウェアスキャン機能があるが、掲載モデルとアプリ一式に対する本用途の監査に置き換えない。[配布基盤の説明](https://huggingface.co/docs/hub/security-malware)

学習元データの条件と配布モデルの条件も区別する。たとえばRAVDESS権利者の現在の説明は、元録音の商用利用と、元録音を含まない・再現しない派生モデル等を区別している。元データが非商用条件だから全派生モデルも自動的に非商用、とは結論しない。逆にモデルカードのMITタグだけで学習・再配布の全経緯が確認できたとも扱わない。[権利者の説明](https://affectivedatascience.com/licensing.html)

採用判断では、配布元・採用版を固定し、実行コードと依存部品を確認し、入力に由来する通信・保存・追加学習がないことを検証する。実際のiPadでのオフライン推論と演じ分けへの反応が確認できるまで、本番対応済みとはしない。利用者の声による追加学習・オンラインデモの利用は行わない。
