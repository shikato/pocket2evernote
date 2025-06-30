# pocket2evernote

🌐 Available Languages: [English](README.md) | [日本語](README_ja.md)

PocketのCSVエクスポートファイルをEvernoteのENEX形式に変換する高度なウェブスクレイピング機能付きコマンドラインツールです。

## 機能

- 🔄 **基本変換**: PocketのCSVをEvernoteのENEX形式に変換
- 🕷️ **ウェブスクレイピング**: 記事の完全なコンテンツを抽出し、Evernoteでの全文検索を実現
- 🔍 **全文検索**: スクレイピングしたコンテンツはEvernote内で完全に検索可能
- 🚀 **デュアルスクレイピング手法**: 軽量HTTP + ヘッドレスブラウザフォールバック
- ⚡ **並列処理**: 複数URLを同時処理（最大20倍高速）
- 💾 **チェックポイントシステム**: 100件ごとに自動進捗保存、中断からの再開可能
- 📊 **進捗追跡**: ETA付きのリアルタイム進捗バー
- 🏷️ **手法識別**: どのスクレイピング手法を使用したかを記録
- 📝 **ENML準拠**: 生成されたコンテンツがEvernoteで正しく表示される
- 🔪 **ファイル分割**: 確実なEvernoteインポートのため大きなENEXファイルを分割（500ノート推奨）

## インストール

```bash
npm install
npm link
```

## 使い方

### 基本的な使い方（URLのみの変換）

```bash
pocket2evernote -i pocket_export.csv -o output.enex
```

### 高度な使い方（ウェブスクレイピング付き）

```bash
# 軽量スクレイピングのみ（高速）
pocket2evernote -i pocket_export.csv -o output.enex --scrape

# ヘッドレスブラウザフォールバック付き（包括的）
pocket2evernote -i pocket_export.csv -o output.enex --scrape --fallback-browser
```

## オプション

- `-i, --input <file>`: 入力CSVファイルのパス（必須）
- `-o, --output <file>`: 出力ENEXファイルのパス（必須）
- `-l, --limit <number>`: 変換するレコード数の上限（デフォルト: 全件）
- `-s, --scrape`: ウェブスクレイピングを有効にして記事の完全なコンテンツを抽出
- `-t, --timeout <number>`: スクレイピングタイムアウト（ミリ秒）（デフォルト: 7000）
- `--fallback-browser`: 軽量スクレイピングが失敗した時のヘッドレスブラウザフォールバック
- `--resume`: 前回のチェックポイントから再開（自動的に進捗を保存）
- `--checkpoint-interval <number>`: N件ごとにチェックポイントを保存（デフォルト: 100）
- `--batch-size <number>`: N件を並列処理するバッチサイズ（デフォルト: 10）

## 使用例

```bash
# 全件をスクレイピング付きで変換（大量データ推奨）
pocket2evernote -i pocket_export.csv -o output.enex --scrape --fallback-browser

# 50件ごとにチェックポイント保存（大量データで安全）
pocket2evernote -i pocket_export.csv -o output.enex --scrape --checkpoint-interval 50

# 中断された処理からの再開
pocket2evernote -i pocket_export.csv -o output.enex --scrape --resume

# 高速並列処理（20件同時処理）
pocket2evernote -i pocket_export.csv -o output.enex --scrape --batch-size 20

# 保守的な並列処理（5件同時処理）
pocket2evernote -i pocket_export.csv -o output.enex --scrape --batch-size 5

# スクレイピングなしの基本変換（最速）
pocket2evernote -i pocket_export.csv -o output.enex
```

## ウェブスクレイピング

### スクレイピング手法

ツールは**2段階のスクレイピングアプローチ**を使用します：

1. **軽量HTTPスクレイピング**（axios + cheerio）: 高速、静的コンテンツに対応
2. **ヘッドレスブラウザスクレイピング**（Puppeteer）: 低速だがJavaScript重用サイトに対応

### 手法識別

スクレイピングされた各ノートには識別ラベルが含まれます：
- `[Scraped via HTTP]`: 軽量手法で正常にスクレイピング
- `[Scraped via Browser]`: ヘッドレスブラウザで正常にスクレイピング
- `[Scraping Failed]`: 両方の手法が失敗

### パフォーマンス

- **処理時間**: URL当たり約1-2秒（レート制限のため）
- **成功率**: デュアル手法アプローチにより高い成功率
- **メモリ使用量**: バッチ処理とチェックポイントで最適化

## 大量データ処理

数千件のレコードを安全に処理するために：

### チェックポイントシステム
- **自動保存**: 100件ごとに進捗を保存（設定可能）
- **再開機能**: `--resume`で最後のチェックポイントから継続
- **中間ファイル**: 処理中に部分的なENEXファイルを保存
- **クラッシュ回復**: 何時間もの処理作業を失うことがない

### 並列処理最適化
- **真の並列処理**: バッチ内で複数URLを同時処理
- **バッチサイズ制御**: 並列処理の強度を設定（デフォルト: 10件同時）
- **メモリクリーンアップ**: バッチ間で自動ガベージコレクション
- **サーバー負荷配慮**: バッチサイズに応じたインテリジェントな待機時間

### 例: 9000件の処理
```bash
# 初回実行（自動的にチェックポイントを作成）
pocket2evernote -i large_export.csv -o output.enex --scrape --fallback-browser --checkpoint-interval 100

# 中断された場合、チェックポイントから再開
pocket2evernote -i large_export.csv -o output.enex --scrape --fallback-browser --resume

# サーバー負荷を抑えた処理（5件並列、頻繁なチェックポイント）
pocket2evernote -i large_export.csv -o output.enex --scrape --batch-size 5 --checkpoint-interval 50

# 高速処理（20件並列）
pocket2evernote -i large_export.csv -o output.enex --scrape --batch-size 20

# フォールバックブラウザ使用時（小さめバッチサイズ推奨）
pocket2evernote -i large_export.csv -o output.enex --scrape --fallback-browser --batch-size 20
```

## 大きなENEXファイルの分割

Evernoteは数千件のノートを含むENEXファイルのインポートで問題が発生する場合があります。`split-enex`コマンドを使用して、大きなENEXファイルを小さなチャンクに分割できます：

### 使い方

```bash
split-enex -i input.enex -o output_folder -n 1000
```

### オプション

- `-i, --input <file>`: 入力ENEXファイルのパス（必須）
- `-o, --output <directory>`: 出力ディレクトリのパス（必須、存在しない場合は作成）
- `-n, --notes-per-file <number>`: ファイルあたりのノート数（デフォルト: 1000）

### 例

```bash
# 9000ノートのENEXファイルを1000ノートずつ9ファイルに分割
split-enex -i output_full.enex -o split_output -n 1000

# 500ノートずつの小さなチャンクに分割
split-enex -i output_full.enex -o split_output -n 500
```

分割されたファイルは以下の形式で命名されます: `元のファイル名_part001.enex`, `元のファイル名_part002.enex` など

## 重要な注意事項

### ノートブックの整理について

**EvernoteはENEX形式においてノートブックの指定をサポートしていません。** これはこのツールの制限ではなく、ENEX形式自体の制限です。

生成されたENEXファイルをEvernoteにインポートする際：
- すべてのノートは「（インポート済み）[ファイル名]」という名前の自動生成されたノートブックに配置されます
- インポート後、手動でノートを目的のノートブックに整理する必要があります
- この動作は、すべてのENEXインポート操作でのEvernoteの一貫した仕様です


### 全文検索

ウェブスクレイピングが有効な場合、生成されるENEXファイルには記事の完全なコンテンツが含まれ、**Evernote内で完全に検索可能**になります。これがスクレイピング機能の主要な利点です。

### CSV形式

このツールは、Pocketの標準的なCSVエクスポート形式を想定しています：

```csv
title,url,time_added,tags,status
記事タイトル,https://example.com/article,1507018057,tag1,tag2,unread
```


### 生成されるコンテンツ

#### スクレイピングなしの場合
各ノートには以下が含まれます：
- **タイトル**: Pocketの記事タイトル（タイトルがない場合はURL）
- **コンテンツ**: 元のURLへのクリック可能なリンク、およびURLとステータス情報
- **タグ**: Pocketからの元のタグ（存在する場合）
- **作成/更新日時**: Pocketの`time_added`タイムスタンプに基づく
- **ソースURL**: 参照用の元のURL

#### スクレイピングありの場合
各ノートには上記に加えて以下が含まれます：
- **記事の完全なコンテンツ**: 抽出・整形された記事テキスト
- **手法識別**: どのスクレイピング手法を使用したかのラベル
- **スクレイピング日**: コンテンツが抽出された日時

## 動作環境

- Node.js 14以上
- npm
- インターネット接続（ウェブスクレイピング用）

## テスト

信頼性を確保するための包括的なテストスイートを実行できます：

```bash
# 全テストを実行
npm test

# カバレッジレポート付きでテスト実行
npm run test:coverage

# 監視モードでテスト実行
npm run test:watch
```

テストスイートの内容：
- **単体テスト**: 核となる機能の検証
- **統合テスト**: コンポーネント間の相互作用確認
- **パフォーマンステスト**: 大量データ処理（1000件以上）
- **エッジケーステスト**: 特殊文字、エンコーディング、エラーハンドリング

テストカバレッジ: 約44%（重要なXML処理とデータ整合性に重点）

## トラブルシューティング

### 高い失敗率
- より良い成功率のために`--fallback-browser`オプションを使用
- 低速サイト用に`-t 15000`でタイムアウトを増加
- 一部のサイトは自動アクセスを完全にブロックする場合があります

### メモリ問題
- `-l`オプションでバッチサイズを削減
- 大規模スクレイピング処理中は他のアプリケーションを終了

### レート制限
- リクエスト間に1秒の組み込み遅延
- 大量処理では一部のサイトで手動介入が必要な場合があります

## ライセンス

MIT

## 貢献

GitHubでのイシューやプルリクエストを歓迎します。

---

**For English documentation, see [README.md](README.md).**