# Tone Mark

アップロードした楽譜の PDF・画像を OMR（光学式楽譜認識）で MusicXML に変換し、
音高を集計したうえで、指定した音高に色を付けた楽譜を生成する Web アプリケーションです。

現在は MVP のバックエンドを実装中の段階で、フロントエンドは未着手です。
詳細な仕様は [SPEC.md](SPEC.md) を参照してください。

## 概要

想定するユーザーの流れは次の通りです。

1. 楽譜の PDF または画像をアップロードする
2. バックエンドが S3 に保存し、OMR ジョブを作成する
3. ワーカーが Audiveris で MusicXML を生成する
4. ユーザーが MusicXML を確認・修正する
5. MusicXML から音符一覧と音高別の出現数を集計する
6. 強調したい音高と色を選び、色付き楽譜を生成する（未実装）

## アーキテクチャ

```
クライアント
  |
API Gateway (HTTP API)
  |
API Lambda  (Hono + @hono/zod-openapi, Node.js)
  - アップロード URL 発行
  - ジョブ作成 / 状態取得
  - MusicXML 取得 / 保存
  - 音高集計
  |
  +--> S3        元ファイル / MusicXML / 解析 JSON
  +--> DynamoDB  ジョブのメタデータと状態 (score_jobs)
  +--> SQS       OMR ジョブキュー / マーク生成キュー
                   |
                 ワーカー Lambda (Docker コンテナ)
                   - Audiveris による OMR
                   - MusicXML を生成して S3 に保存
```

API は AWS CDK（TypeScript）で構築します。ワーカー Lambda は Audiveris 5.10.2 と
Tesseract を同梱した x86_64 の Docker イメージで動作します。

## ディレクトリ構成

```
.
├── bin/tone-mark.ts          CDK アプリのエントリポイント
├── lib/tone-mark-stack.ts    CDK スタック定義
├── lambda/
│   ├── api/                  API Lambda（Hono + OpenAPI）
│   └── worker/               ワーカー Lambda（Audiveris コンテナ）
├── sample-pdf/               動作確認用のサンプル楽譜
├── SPEC.md                   仕様書
├── cdk.json
├── package.json
└── tsconfig.json
```

## 必要要件

- Node.js（API Lambda・CDK は Node.js 24 系を想定）
- pnpm（`package.json` の packageManager は pnpm 10 系）
- Docker（ワーカー Lambda の x86_64 コンテナイメージのビルドに必要）
- AWS アカウントと認証情報、および対象リージョンで CDK bootstrap 済みであること

## セットアップ

```
pnpm install
```

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm build` | TypeScript の型チェック（`tsc --noEmit`） |
| `pnpm test` | テスト実行（`node:test` を tsx で実行） |
| `pnpm check` | Biome による Lint とフォーマット確認 |
| `pnpm format` | Biome によるフォーマット適用 |
| `pnpm synth` | CloudFormation テンプレートの合成 |
| `pnpm diff` | デプロイ済みスタックとの差分表示 |
| `pnpm deploy` | スタックのデプロイ |

## デプロイ

```
pnpm deploy
```

`pnpm deploy` はワーカー Lambda の Docker イメージをビルドして ECR へプッシュし、
CloudFormation スタックを更新します。Docker が起動している必要があります。
ワーカーイメージは x86_64 でビルドされます（公式の Audiveris Linux バイナリが
x86_64 のみ提供されているため）。

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/scores/upload-url` | アップロード用の presigned S3 URL を発行 |
| POST | `/scores` | OMR ジョブを作成（SQS に投入） |
| GET | `/scores/{score_id}` | ジョブの状態とメタデータを取得 |
| GET | `/scores/{score_id}/musicxml-url` | 生成された MusicXML のダウンロード URL を取得 |
| PUT | `/scores/{score_id}/musicxml` | 確認・修正した MusicXML を保存 |
| POST | `/scores/{score_id}/analyze` | MusicXML を解析し音高別の出現数を集計 |
| GET | `/doc` | OpenAPI ドキュメント（JSON） |
| GET | `/ui` | Swagger UI |

## ジョブの状態遷移

```
created -> queued -> processing_omr -> needs_review -> analyzed
```

処理に失敗した場合は `failed` となり、`error_message` に原因が記録されます。

## 開発状況

実装済み:

- アップロード URL 発行、ジョブ作成、状態取得
- Audiveris によるワーカーでの OMR と MusicXML 生成
- MusicXML の取得・保存
- MusicXML からの音高集計

未実装:

- 色付き楽譜の生成（マーク生成）とダウンロード
- フロントエンド
- 認証
