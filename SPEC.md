# Tone Mark SPEC

## 1. 概要

Tone Markは、アップロードされた楽譜PDFまたは画像をAudiverisでOMR認識し、生成されたMusicXMLを確認・修正した上で、指定した音高の音符に色を付けた楽譜を表示・ダウンロードできるWebアプリケーションである。

MVPでは、元PDFへ直接マークを重ねるのではなく、MusicXMLから再レンダリングした色付き楽譜をPDF/PNGとして生成する。元PDFまたは元画像への座標オーバーレイは将来拡張とする。

## 2. 目的

- 楽譜内に含まれる音高を自動集計する
- ユーザーが `C4`, `C5` などの音高を選択できる
- 選択された音高に対応する音符へ色を付けた楽譜を表示する
- 色付き楽譜をPDFまたはPNGでダウンロードできる
- AudiverisのOMR結果をMusicXMLとして確認・修正できる

## 3. 対象ユーザー

- 音楽教育者
- 楽譜分析を行うユーザー
- 練習用に特定音高を視覚的に強調したい演奏者
- 楽譜データをMusicXMLとして確認・補正したいユーザー

## 4. MVPスコープ

### 4.1 含める機能

- PDFまたは画像のアップロード
- AudiverisによるOMR処理
- MusicXML生成
- MusicXMLの表示・編集・保存
- MusicXMLからの音符一覧抽出
- 音高別の出現回数集計
- 音高選択UI
- 選択音高への色指定
- 色付き楽譜プレビュー
- 色付きPDF/PNGの生成
- 生成ファイルのダウンロード
- ジョブ状態の確認

### 4.2 MVPでは含めない機能

- 元PDF/元画像への完全一致オーバーレイ
- 複数ユーザーによる同時共同編集
- 楽譜エディタとしての高度な記譜編集
- 課金機能
- バージョン履歴管理
- リアルタイムWebSocket通知

## 5. ユーザーフロー

```text
1. ユーザーが楽譜PDF/画像をアップロードする
2. バックエンドがS3へ保存する
3. OMRジョブが作成される
4. AudiverisがMusicXMLを生成する
5. ユーザーがMusicXMLを確認・修正する
6. システムが音符一覧と音高集計を生成する
7. ユーザーが強調したい音高と色を選択する
8. システムが色付き楽譜を生成する
9. ユーザーが画面で確認する
10. ユーザーがPDFまたはPNGをダウンロードする
```

## 6. 画面要件

### 6.1 アップロード画面

- PDF、PNG、JPG、JPEGをアップロードできる
- アップロード可能なファイルサイズ上限を表示する
- アップロード後、OMR処理画面へ遷移する

### 6.2 ジョブ進捗画面

- 現在の処理状態を表示する
- 処理中は数秒間隔でステータスをpollingする
- エラー時は原因メッセージを表示する

状態例:

```text
uploaded
queued
processing_omr
needs_review
processing_analysis
processing_mark
completed
failed
```

### 6.3 MusicXML確認・修正画面

- 生成されたMusicXMLを表示する
- ユーザーがMusicXMLを編集できる
- 編集後のMusicXMLを保存できる
- 保存後、音高集計を再実行できる

MVPではMonaco Editorなどのテキストエディタ形式でよい。将来的には楽譜ビュー上の編集UIを検討する。

### 6.4 音高集計画面

- 音高ごとの出現回数を表示する
- 音高を複数選択できる
- 選択した音高ごとに色を指定できる

例:

| Pitch | Count | Color |
| --- | ---: | --- |
| C4 | 18 | red |
| C5 | 7 | blue |
| D4 | 12 | green |

### 6.5 色付き楽譜プレビュー画面

- 選択された音高に色が付いた楽譜を表示する
- PDFまたはPNGの生成結果を確認できる
- PDFダウンロードボタンを表示する
- PNGダウンロードボタンを表示する

## 7. バックエンド構成

### 7.1 推奨アーキテクチャ

```text
Frontend
  SvelteKit or React
  |
API
  API Gateway or Lambda Function URL
  |
Lambda API
  - upload URL発行
  - job作成
  - status取得
  - MusicXML取得/保存
  - mark生成リクエスト
  |
S3
  - original files
  - MusicXML
  - notes.json
  - pitch_counts.json
  - marked.pdf
  - marked.png
  |
SQS
  - OMR job queue
  - mark generation queue
  |
Lambda Container or ECS Fargate
  - Audiveris
  - music21
  - rendering tools
  |
DynamoDB
  - job metadata
  - status
  - S3 object keys
```

### 7.2 AWSサービス

| 領域 | 技術 |
| --- | --- |
| API | API Gateway + Lambda または Lambda Function URL |
| ファイル保存 | S3 |
| 非同期ジョブ | SQS |
| 状態管理 | DynamoDB |
| OMR実行 | Lambda Container または ECS Fargate |
| 認証 | Cognito / Auth.js / Clerk |
| フロント配信 | CloudFront + S3 / Amplify Hosting / Cloudflare Pages |

### 7.3 Lambda Containerに含めるもの

- Java Runtime
- Audiveris
- Python
- music21
- lxml
- pydantic
- PyMuPDF
- Pillow
- 必要に応じてVerovioまたはMuseScore CLI

## 8. フロントエンド構成

### 8.1 推奨技術

MVPではSvelteKitまたはReactを使用する。

候補:

- SvelteKit
- React / Next.js
- TypeScript
- OpenSheetMusicDisplay
- Verovio
- Monaco Editor

### 8.2 楽譜表示

MVPではMusicXMLをブラウザ上で表示できるライブラリを使う。

候補:

- OpenSheetMusicDisplay
- Verovio

要件:

- MusicXMLを表示できる
- 選択音高の色分け表示ができる
- SVGとして扱える
- PDF/PNG生成処理と連携できる

## 9. データ設計

### 9.1 S3オブジェクト構成

```text
scores/{score_id}/original.pdf
scores/{score_id}/original.png
scores/{score_id}/result.musicxml
scores/{score_id}/notes.json
scores/{score_id}/pitch_counts.json
scores/{score_id}/marked.pdf
scores/{score_id}/marked.png
scores/{score_id}/rendered.svg
```

### 9.2 DynamoDBテーブル

テーブル名:

```text
score_jobs
```

MVPでユーザー管理を入れる場合:

```text
PK: USER#{user_id}
SK: SCORE#{score_id}
```

ユーザー管理なしの最小構成:

```text
PK: SCORE#{score_id}
```

属性:

```json
{
  "score_id": "score_abc123",
  "user_id": "user_xxx",
  "status": "completed",
  "original_key": "scores/score_abc123/original.pdf",
  "musicxml_key": "scores/score_abc123/result.musicxml",
  "notes_json_key": "scores/score_abc123/notes.json",
  "pitch_counts_key": "scores/score_abc123/pitch_counts.json",
  "marked_pdf_key": "scores/score_abc123/marked.pdf",
  "marked_png_key": "scores/score_abc123/marked.png",
  "error_message": null,
  "created_at": "2026-05-20T10:00:00+09:00",
  "updated_at": "2026-05-20T10:03:00+09:00"
}
```

### 9.3 notes.json

```json
[
  {
    "id": "n_001",
    "pitch": "C4",
    "step": "C",
    "alter": 0,
    "octave": 4,
    "measure": 3,
    "part": "P1",
    "voice": 1,
    "staff": 1,
    "duration": 1.0
  }
]
```

### 9.4 pitch_counts.json

```json
{
  "C4": 18,
  "C5": 7,
  "D4": 12,
  "E4": 9
}
```

### 9.5 mark request

```json
{
  "targets": [
    {
      "pitch": "C4",
      "color": "#ff3b30"
    },
    {
      "pitch": "C5",
      "color": "#007aff"
    }
  ],
  "output_formats": ["pdf", "png"]
}
```

## 10. API設計

### 10.1 アップロードURL発行

```http
POST /scores/upload-url
```

Request:

```json
{
  "filename": "score.pdf",
  "content_type": "application/pdf"
}
```

Response:

```json
{
  "score_id": "score_abc123",
  "upload_url": "https://...",
  "object_key": "scores/score_abc123/original.pdf"
}
```

### 10.2 ジョブ作成

```http
POST /scores
```

Request:

```json
{
  "score_id": "score_abc123",
  "original_key": "scores/score_abc123/original.pdf"
}
```

Response:

```json
{
  "score_id": "score_abc123",
  "status": "queued"
}
```

### 10.3 ステータス取得

```http
GET /scores/{score_id}
```

Response:

```json
{
  "score_id": "score_abc123",
  "status": "needs_review",
  "musicxml_key": "scores/score_abc123/result.musicxml",
  "error_message": null
}
```

### 10.4 MusicXML取得

```http
GET /scores/{score_id}/musicxml
```

Response:

```json
{
  "score_id": "score_abc123",
  "musicxml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>..."
}
```

### 10.5 MusicXML保存

```http
PUT /scores/{score_id}/musicxml
```

Request:

```json
{
  "musicxml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>..."
}
```

Response:

```json
{
  "score_id": "score_abc123",
  "status": "processing_analysis"
}
```

### 10.6 音高集計取得

```http
GET /scores/{score_id}/pitch-counts
```

Response:

```json
{
  "score_id": "score_abc123",
  "pitch_counts": {
    "C4": 18,
    "C5": 7
  }
}
```

### 10.7 マーク生成

```http
POST /scores/{score_id}/mark
```

Request:

```json
{
  "targets": [
    {
      "pitch": "C4",
      "color": "#ff3b30"
    },
    {
      "pitch": "C5",
      "color": "#007aff"
    }
  ],
  "output_formats": ["pdf", "png"]
}
```

Response:

```json
{
  "score_id": "score_abc123",
  "status": "processing_mark"
}
```

### 10.8 ダウンロードURL取得

```http
GET /scores/{score_id}/download-url?format=pdf
```

Response:

```json
{
  "score_id": "score_abc123",
  "format": "pdf",
  "download_url": "https://..."
}
```

## 11. 処理詳細

### 11.1 OMR処理

```text
1. SQSからOMRジョブを取得
2. S3から元PDF/画像をダウンロード
3. Audiverisを実行
4. MusicXMLを生成
5. MusicXMLをS3へ保存
6. DynamoDBのstatusをneeds_reviewへ更新
```

### 11.2 音高集計処理

```text
1. S3からMusicXMLを取得
2. music21またはXML parserで音符を抽出
3. pitch表記を正規化する
4. notes.jsonを生成する
5. pitch_counts.jsonを生成する
6. S3へ保存する
7. DynamoDBを更新する
```

音高表記:

```text
C4
C#4
Db4
C5
```

MVPではMusicXML内の表記に基づき、必要に応じてシャープ/フラットの正規化ルールを後で追加する。

### 11.3 色付き楽譜生成

```text
1. S3からMusicXMLを取得
2. ユーザー指定のtarget pitchesを受け取る
3. 対象音符に色指定を適用する
4. SVGとしてレンダリングする
5. SVGをPDF/PNGに変換する
6. S3へ保存する
7. DynamoDBをcompletedへ更新する
```

## 12. 元PDF/画像への直接マーキングについて

MVPでは対象外とする。

理由:

- MusicXMLだけでは元PDF上の音符座標を十分に取得できない
- Audiverisの認識結果と元画像座標の対応付けが必要になる
- MusicXML修正後に座標対応を維持するのが難しい
- 実装コストが高く、MVPの不確実性が大きい

将来実装する場合は以下を検討する。

- Audiveris内部の座標情報取得
- 元PDFを画像化した上でのOpenCV処理
- PyMuPDFによるPDF annotation
- 音符bounding boxの保存
- MusicXML note idと画像座標の対応管理

## 13. 非機能要件

### 13.1 パフォーマンス

- アップロード完了後、OMR処理は非同期で実行する
- フロントエンドはステータスpollingで進捗を取得する
- OMR処理は1ジョブ単位で独立実行する

### 13.2 セキュリティ

- S3オブジェクトは原則privateにする
- アップロードとダウンロードはpresigned URLを使う
- APIは認証済みユーザーのみアクセス可能にする
- LambdaからS3/DynamoDB/SQSへのアクセスはIAM Roleで制御する
- ユーザーが他ユーザーのscore_idへアクセスできないようにする

### 13.3 可用性

- ジョブ失敗時はDynamoDBにerror_messageを保存する
- SQSのDLQを設定する
- OMR処理のタイムアウトを明示する

### 13.4 コスト

- MVPではオンデマンド課金を優先する
- DynamoDBはオンデマンドモードで開始する
- 処理頻度が低い間はLambda Containerを優先する
- 長時間処理や大量処理が増えた場合はECS Fargateへ移行する

## 14. 技術選定

| 領域 | MVP推奨 |
| --- | --- |
| フロントエンド | SvelteKit / React |
| 言語 | TypeScript |
| 楽譜表示 | OpenSheetMusicDisplay / Verovio |
| MusicXML編集 | Monaco Editor |
| API | API Gateway + Lambda |
| ファイル保存 | S3 |
| 非同期処理 | SQS |
| 状態管理 | DynamoDB |
| OMR | Audiveris |
| OMR実行環境 | Lambda Container |
| 解析 | Python + music21 |
| PDF/PNG生成 | Verovio / MuseScore CLI / SVG変換 |
| 認証 | Cognito / Auth.js / Clerk |

## 15. 実装フェーズ

### Phase 1: プロトタイプ

- ローカルでAudiverisを実行する
- サンプルPDFからMusicXMLを生成する
- MusicXMLから音高集計を作る
- 色付きSVGを生成する

### Phase 2: MVP Backend

- S3アップロードを実装する
- DynamoDBにジョブ状態を保存する
- SQSでOMRジョブを非同期化する
- Lambda ContainerでAudiverisを実行する

### Phase 3: MVP Frontend

- アップロード画面を作る
- ジョブ進捗画面を作る
- MusicXML確認・修正画面を作る
- 音高集計と色選択UIを作る
- 色付き楽譜プレビューを作る

### Phase 4: 出力生成

- 色付きPDF生成を実装する
- 色付きPNG生成を実装する
- ダウンロードURL発行を実装する

### Phase 5: 改善

- 認証を追加する
- エラー表示を改善する
- OMR失敗時の再実行を追加する
- 元PDFへの直接マーキングを調査する

## 16. 未決定事項

- フロントエンドをSvelteKitにするかReact/Next.jsにするか
- 楽譜レンダリングにOpenSheetMusicDisplayを使うかVerovioを使うか
- PDF生成にMuseScore CLIを使うかSVG変換ベースにするか
- 認証をCognito、Auth.js、Clerkのどれにするか
- Lambda Containerで十分か、ECS Fargateを初期採用するか
- 音高表記で異名同音を統合するかどうか

## 17. 受け入れ条件

- ユーザーがPDFまたは画像をアップロードできる
- AudiverisでMusicXMLが生成される
- MusicXMLを画面で確認・修正できる
- MusicXMLから音高別の出現回数が表示される
- `C4`, `C5` など複数の音高を選択できる
- 選択した音高の音符に色が付いた楽譜を表示できる
- 色付き楽譜をPDFまたはPNGでダウンロードできる
- 処理中、完了、失敗の状態が画面に表示される
