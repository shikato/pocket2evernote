#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { Builder } = require('xml2js');
const { program } = require('commander');
const axios = require('axios');
const cheerio = require('cheerio');
const cliProgress = require('cli-progress');
const puppeteer = require('puppeteer');
const path = require('path');

// テスト環境では引数解析をスキップ
let options = {};
if (require.main === module) {
  program
    .version('1.0.0')
    .description('Convert Pocket CSV export to Evernote ENEX format')
    .requiredOption('-i, --input <file>', 'Input CSV file path')
    .requiredOption('-o, --output <file>', 'Output ENEX file path')
    .option('-l, --limit <number>', 'Limit number of records to convert', '999999')
    .option('-s, --scrape', 'Enable web scraping to extract full article content')
    .option('-t, --timeout <number>', 'Scraping timeout in milliseconds', '7000')
    .option('--fallback-browser', 'Use headless browser as fallback when lightweight scraping fails')
    .option('--resume', 'Resume from previous checkpoint')
    .option('--checkpoint-interval <number>', 'Save checkpoint every N records', '100')
    .option('--batch-size <number>', 'Process records in batches of N (parallel)', '10')
    .parse(process.argv);

  options = program.opts();
}

// スクレイピング設定（テスト環境ではデフォルト値を使用）
const getAxiosConfig = () => ({
  timeout: parseInt(options.timeout || 7000),
  responseType: 'arraybuffer', // バイナリデータとして取得
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
});

// チェックポイント管理クラス
class CheckpointManager {
  constructor(outputPath, options = {}) {
    this.outputPath = outputPath;
    this.checkpointPath = outputPath.replace(/\.enex$/, '.checkpoint.json');
    this.interval = parseInt(options.checkpointInterval || 100);
    this.batchSize = parseInt(options.batchSize || 10);
    this.progress = {
      processedCount: 0,
      totalCount: 0,
      lastProcessedIndex: -1,
      failedUrls: [],
      processedNotes: [],
      timestamp: Date.now(),
      startTime: Date.now()
    };
  }

  // チェックポイントファイルが存在するかチェック
  hasCheckpoint() {
    return fs.existsSync(this.checkpointPath);
  }

  // チェックポイントから復元
  loadCheckpoint() {
    if (!this.hasCheckpoint()) {
      return null;
    }

    try {
      const data = fs.readFileSync(this.checkpointPath, 'utf8');
      this.progress = JSON.parse(data);
      console.log(`\nResuming from checkpoint:`);
      console.log(`  Processed: ${this.progress.processedCount}/${this.progress.totalCount}`);
      console.log(`  Failed URLs: ${this.progress.failedUrls.length}`);
      console.log(`  Last index: ${this.progress.lastProcessedIndex}`);
      return this.progress;
    } catch (error) {
      console.error('Failed to load checkpoint:', error.message);
      return null;
    }
  }

  // チェックポイントを保存
  saveCheckpoint() {
    try {
      this.progress.timestamp = Date.now();
      fs.writeFileSync(this.checkpointPath, JSON.stringify(this.progress, null, 2));
      // コンソール出力を削除（進捗バーを中断しない）
    } catch (error) {
      console.error('Failed to save checkpoint:', error.message);
    }
  }

  // 中間ENEXファイルを保存
  saveIntermediateEnex() {
    if (this.progress.processedNotes.length === 0) return;

    try {
      const intermediatePath = this.outputPath.replace(/\.enex$/, `.checkpoint_${this.progress.processedCount}.enex`);
      const enexData = createEnexStructure(this.progress.processedNotes);
      const builder = new Builder({
        xmldec: { version: '1.0', encoding: 'UTF-8' },
        renderOpts: { pretty: true, indent: '  ' }
      });

      let xml = builder.buildObject(enexData)
        .replace(/<content>(.+?)<\/content>/gs, (match, p1) => {
          const decodedContent = p1
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"');
          return `<content>\n      <![CDATA[${decodedContent}]]>\n    </content>`;
        });

      xml = xml.replace(
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">'
      );

      fs.writeFileSync(intermediatePath, xml);
      // コンソール出力を削除（進捗バーを中断しない）
    } catch (error) {
      // エラーメッセージも抑制（進捗バーを中断しない）
    }
  }

  // 進捗を更新
  updateProgress(processedCount, totalCount, lastIndex, note = null, failedUrl = null) {
    this.progress.processedCount = processedCount;
    this.progress.totalCount = totalCount;
    this.progress.lastProcessedIndex = lastIndex;

    if (note) {
      this.progress.processedNotes.push(note);
    }

    if (failedUrl) {
      this.progress.failedUrls.push(failedUrl);
    }

    // チェックポイント間隔でセーブ（サイレント）
    if (processedCount % this.interval === 0) {
      this.saveCheckpoint();
      this.saveIntermediateEnex();
    }
  }

  // チェックポイントファイルを削除
  cleanup() {
    try {
      if (this.hasCheckpoint()) {
        fs.unlinkSync(this.checkpointPath);
        // サイレントクリーンアップ
      }
    } catch (error) {
      console.error('Failed to cleanup checkpoint:', error.message);
    }
  }

  // 統計情報を表示
  showStats() {
    const elapsed = Date.now() - this.progress.startTime;
    const rate = this.progress.processedCount / (elapsed / 1000);
    
    console.log(`\nProcessing Statistics:`);
    console.log(`  Total processed: ${this.progress.processedCount}/${this.progress.totalCount}`);
    console.log(`  Success rate: ${((this.progress.processedCount - this.progress.failedUrls.length) / this.progress.processedCount * 100).toFixed(1)}%`);
    console.log(`  Failed URLs: ${this.progress.failedUrls.length}`);
    console.log(`  Processing rate: ${rate.toFixed(2)} items/sec`);
    console.log(`  Elapsed time: ${(elapsed / 1000 / 60).toFixed(1)} minutes`);
    
    // チェックポイント情報を追加
    if (this.interval && this.progress.processedCount > 0) {
      const checkpointCount = Math.floor(this.progress.processedCount / this.interval);
      if (checkpointCount > 0) {
        console.log(`  Checkpoints saved: ${checkpointCount}`);
      }
    }
  }
}

function formatDate(timestamp) {
  const date = new Date(parseInt(timestamp) * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function detectEncoding(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 1024));
  if (text.includes('charset=EUC-JP') || text.includes('charset=euc-jp')) {
    return 'euc-jp';
  } else if (text.includes('charset=Shift_JIS') || text.includes('charset=shift_jis')) {
    return 'shift_jis';
  }
  return 'utf8';
}

// バイナリファイルかどうかを判定
function isBinaryUrl(url) {
  const binaryExtensions = [
    // 画像ファイル
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff', '.tif', '.psd', '.ai', '.eps',
    // 動画ファイル
    '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp', '.ogv', '.mpg', '.mpeg',
    // 音声ファイル
    '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma', '.opus', '.amr',
    // ドキュメント
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
    // アーカイブ
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.dmg', '.iso',
    // 実行ファイル
    '.exe', '.msi', '.app', '.deb', '.rpm', '.apk', '.ipa',
    // データファイル
    '.db', '.sqlite', '.bin', '.dat', '.pak',
    // フォント
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    // その他
    '.swf', '.fla', '.sketch'
  ];
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    return binaryExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

async function scrapeContent(url) {
  try {
    // バイナリファイルの場合は専用処理
    if (isBinaryUrl(url)) {
      const escapedUrl = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const filename = pathname.split('/').pop() || 'file';
      
      // ファイル種別に応じた処理
      if (pathname.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tiff|tif|psd|ai|eps)$/i)) {
        return `<div>
<img src="${escapedUrl}" alt="Image"/>
<p>Image: ${filename}</p>
</div>`;
      } else if (pathname.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp|ogv|mpg|mpeg)$/i)) {
        return `<div>
<p>Video file: <a href="${escapedUrl}">${filename}</a></p>
<p><em>Video preview not available in Evernote</em></p>
</div>`;
      } else if (pathname.match(/\.(mp3|wav|ogg|m4a|aac|flac|wma|opus|amr)$/i)) {
        return `<div>
<p>Audio file: <a href="${escapedUrl}">${filename}</a></p>
<p><em>Audio preview not available in Evernote</em></p>
</div>`;
      } else if (pathname.match(/\.(pdf)$/i)) {
        return `<div>
<p>PDF document: <a href="${escapedUrl}">${filename}</a></p>
</div>`;
      } else if (pathname.match(/\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf)$/i)) {
        return `<div>
<p>Document: <a href="${escapedUrl}">${filename}</a></p>
</div>`;
      } else if (pathname.match(/\.(zip|rar|7z|tar|gz|bz2|xz|dmg|iso)$/i)) {
        return `<div>
<p>Archive file: <a href="${escapedUrl}">${filename}</a></p>
</div>`;
      } else {
        const ext = pathname.split('.').pop() || 'unknown';
        return `<div>
<p>Binary file (${ext.toUpperCase()}): <a href="${escapedUrl}">${filename}</a></p>
</div>`;
      }
    }
    
    const response = await axios.get(url, getAxiosConfig());
    
    // Content-Typeをチェック
    const contentType = response.headers['content-type'] || '';
    
    // HTMLコンテンツでない場合はバイナリファイルとして処理
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      const urlObj = new URL(url);
      const filename = urlObj.pathname.split('/').pop() || 'file';
      const mimeType = contentType.split(';')[0].trim();
      
      return `<div>
<p>File: <a href="${url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">${filename}</a></p>
<p><small>Content-Type: ${mimeType}</small></p>
</div>`;
    }
    
    // エンコーディングを検出
    const encoding = detectEncoding(response.data);
    let htmlData;
    
    if (encoding === 'euc-jp') {
      const iconv = require('iconv-lite');
      htmlData = iconv.decode(response.data, 'euc-jp');
    } else if (encoding === 'shift_jis') {
      const iconv = require('iconv-lite');
      htmlData = iconv.decode(response.data, 'shift_jis');
    } else {
      htmlData = response.data.toString('utf8');
    }
    
    const $ = cheerio.load(htmlData);
    
    // 不要な要素を削除
    $('script, style, noscript, nav, footer, header, aside').remove();
    $('.sidebar, .ads, .advertisement, .social-share, .comments, .navigation, .breadcrumb').remove();
    $('.menu, .nav, .navbar, .header, .footer, .related, .recommend').remove();
    
    // コメント文を削除
    $('*').contents().filter(function() {
      return this.type === 'comment';
    }).remove();
    
    // 記事の本文を特定（優先順位順）
    const contentSelectors = [
      'article .content',
      'article .post-content', 
      'article .entry-content',
      'article .text',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      'article',
      'main',
      '[role="main"]',
      '#content',
      '.post-body',
      '.article-body',
      // サイト固有のセレクタ
      '.article', '.story', '.entry', '.post',
      '#main', '#article', '#story',
      'body' // 最後の手段
    ];
    
    let content = '';
    let contentElement = null;
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = element.text().trim();
        // より寛容な条件に変更
        if (text.length > 100) {
          contentElement = element;
          break;
        }
      }
    }
    
    // 見つからない場合の詳細検索
    if (!contentElement) {
      let maxTextLength = 0;
      $('div, section, article, p').each(function() {
        const $this = $(this);
        const text = $this.text().trim();
        
        // より寛容な条件で選択
        if (text.length > maxTextLength && text.length > 100) {
          maxTextLength = text.length;
          contentElement = $this;
        }
      });
    }
    
    if (contentElement) {
      // さらに不要な子要素を削除
      contentElement.find('nav, .nav, .menu, .sidebar, .social, .share, .twitter, .facebook').remove();
      content = contentElement.html();
    }
    
    // ENMLフォーマットに変換
    if (content) {
      const contentCheerio = cheerio.load(content);
      
      // まずテキストを抽出
      const textContent = contentCheerio.text();
      
      if (textContent.trim().length < 50) {
        return `<p>Content could not be extracted from ${url}</p>`;
      }
      
      // テキストを改行と句点で段落に分割
      const lines = textContent
        .replace(/\s+/g, ' ') // 複数の空白を1つに
        .split(/[。\n]/) // 句点または改行で分割
        .map(line => line.trim())
        .filter(line => line.length > 20); // 短すぎる行は除外
      
      // ENMLフォーマットに変換
      let enmlContent = '';
      let currentParagraph = '';
      
      lines.forEach(line => {
        if (line.length > 0) {
          currentParagraph += line + '。';
          
          // 段落が十分な長さになったら改行
          if (currentParagraph.length > 150 || line.includes('：') || line.includes('■')) {
            if (currentParagraph.trim().length > 0) {
              const escapedText = currentParagraph
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              enmlContent += `<p>${escapedText}</p>\n`;
            }
            currentParagraph = '';
          }
        }
      });
      
      // 残った内容があれば追加
      if (currentParagraph.trim().length > 0) {
        const escapedText = currentParagraph
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        enmlContent += `<p>${escapedText}</p>\n`;
      }
      
      return enmlContent || `<p>Content extracted from ${url}</p>`;
    }
    
    return `<p>Content could not be extracted from ${url}</p>`;
  } catch (error) {
    // エラーメッセージは進捗バー完了後に表示するため、ここでは記録のみ
    return `<p>Failed to scrape content from ${url}: ${error.message}</p>`;
  }
}

// ブラウザインスタンス管理クラス
class BrowserManager {
  constructor() {
    this.browser = null;
    this.pagePool = [];
    this.maxPages = 10; // 最大ページ数
    this.restartInterval = 1000; // 1000件ごとに再起動
    this.processedCount = 0;
  }

  async getBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({ 
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        protocolTimeout: 30000,
        timeout: 30000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      });
    }
    return this.browser;
  }

  async getPage() {
    // 定期的な再起動チェック
    if (this.shouldRestart()) {
      await this.restart();
    }
    
    // 利用可能なページがあれば再利用
    if (this.pagePool.length > 0) {
      this.processedCount++;
      return this.pagePool.pop();
    }
    
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    this.processedCount++;
    return page;
  }

  shouldRestart() {
    return this.processedCount > 0 && this.processedCount % this.restartInterval === 0;
  }

  async restart() {
    console.log(`\nRestarting browser after ${this.processedCount} processed pages...`);
    await this.cleanup();
    // processedCountはリセットしない（累積カウント）
  }

  async releasePage(page) {
    try {
      // ページを確実に閉じる
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      console.error('Error closing page:', error.message);
    }
  }

  async cleanup() {
    console.log('Cleaning up browser resources...');
    
    // すべてのページを閉じる
    for (const page of this.pagePool) {
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch (err) {
        console.error('Failed to close page:', err.message);
      }
    }
    this.pagePool = [];
    
    // ブラウザを閉じる
    if (this.browser) {
      try {
        // すべてのページを取得して閉じる
        const pages = await this.browser.pages();
        await Promise.all(
          pages.map(page => page.close().catch(e => console.error('Page close error:', e.message)))
        );
        
        // ブラウザコンテキストを閉じる
        const contexts = this.browser.browserContexts();
        await Promise.all(
          contexts.map(context => {
            if (context !== this.browser.defaultBrowserContext()) {
              return context.close().catch(e => console.error('Context close error:', e.message));
            }
          })
        );
        
        // ブラウザを閉じる
        await this.browser.close();
        console.log('Browser closed successfully');
        
      } catch (error) {
        console.error('Error closing browser:', error.message);
        
        // 強制的にプロセスを終了
        try {
          const browserProcess = this.browser.process();
          if (browserProcess && !browserProcess.killed) {
            console.log('Force killing browser process...');
            browserProcess.kill('SIGKILL');
            
            // 子プロセスも終了
            const pid = browserProcess.pid;
            if (pid) {
              try {
                // macOSで子プロセスも含めて終了
                require('child_process').execSync(`pkill -KILL -P ${pid}`);
              } catch (e) {
                // エラーは無視（プロセスが既に終了している場合など）
              }
            }
          }
        } catch (killError) {
          console.error('Failed to kill browser process:', killError.message);
        }
      } finally {
        this.browser = null;
      }
    }
  }
}

// グローバルブラウザマネージャー
const browserManager = new BrowserManager();

// プロセス終了時のクリーンアップ処理
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  try {
    await browserManager.cleanup();
  } catch (error) {
    console.error('Shutdown cleanup error:', error);
  }
  process.exit(0);
}

// シグナルハンドリング
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 未処理のPromiseエラーをキャッチ
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await browserManager.cleanup();
  process.exit(1);
});

// スクレイピング結果に手法の識別子を追加
function addScrapingMethodInfo(content, method) {
  if (!content) return content;
  
  const methodLabel = {
    'lightweight': 'Scraped via HTTP',
    'browser': 'Scraped via Browser',
    'failed': 'Scraping Failed'
  };
  
  if (content.includes('Failed to scrape') || content.includes('Content could not be extracted')) {
    return content.replace(/(<p>.*?<\/p>)/, `$1\n<p><small>[${methodLabel.failed}]</small></p>`);
  }
  
  return content + `\n<p><small>[${methodLabel[method]}]</small></p>`;
}

async function scrapeWithPuppeteer(url) {
  let page = null;
  try {
    page = await browserManager.getPage();
    
    // タイムアウト設定
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: parseInt(options.timeout || 7000)
    });
    
    // JavaScriptの実行を待つ
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // メインコンテンツを抽出
    const content = await page.evaluate(() => {
      // 不要な要素を削除
      const unwantedElements = document.querySelectorAll('script, style, noscript, nav, footer, header, aside, .sidebar, .ads, .advertisement, .social-share, .comments, .navigation, .breadcrumb, .menu, .nav, .navbar, .header, .footer, .related, .recommend');
      unwantedElements.forEach(el => el.remove());
      
      // メインコンテンツを特定
      const contentSelectors = [
        'article .content',
        'article .post-content', 
        'article .entry-content',
        'article .text',
        '.article-content',
        '.post-content',
        '.entry-content',
        '.content',
        'article',
        'main',
        '[role="main"]',
        '#content',
        '.post-body',
        '.article-body',
        '.article', '.story', '.entry', '.post',
        '#main', '#article', '#story',
        'body'
      ];
      
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.innerText || element.textContent;
          if (text && text.trim().length > 100) {
            return text.trim();
          }
        }
      }
      
      // フォールバック: body全体のテキスト
      return document.body.innerText || document.body.textContent || '';
    });
    
    if (!content || content.trim().length < 50) {
      return `<p>Content could not be extracted from ${url} (browser)</p>`;
    }
    
    // ENMLフォーマットに変換
    const lines = content
      .replace(/\s+/g, ' ')
      .split(/[。\n]/)
      .map(line => line.trim())
      .filter(line => line.length > 20);
    
    let enmlContent = '';
    let currentParagraph = '';
    
    lines.forEach(line => {
      if (line.length > 0) {
        currentParagraph += line + '。';
        
        if (currentParagraph.length > 150 || line.includes('：') || line.includes('■')) {
          if (currentParagraph.trim().length > 0) {
            const escapedText = currentParagraph
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
            enmlContent += `<p>${escapedText}</p>\n`;
          }
          currentParagraph = '';
        }
      }
    });
    
    if (currentParagraph.trim().length > 0) {
      const escapedText = currentParagraph
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      enmlContent += `<p>${escapedText}</p>\n`;
    }
    
    return enmlContent || `<p>Content extracted from ${url} (browser)</p>`;
    
  } catch (error) {
    return `<p>Failed to scrape content from ${url} (browser): ${error.message}</p>`;
  } finally {
    if (page) {
      browserManager.releasePage(page);
    }
  }
}

function createEnexStructure(notes) {
  return {
    'en-export': {
      $: {
        'export-date': formatDate(Date.now() / 1000),
        'application': 'Evernote',
        'version': '10.0'
      },
      note: notes
    }
  };
}

// XML無効文字を除去
function removeInvalidXmlChars(text) {
  if (!text) return text;
  // XML 1.0で無効な文字を除去: 制御文字など
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function escapeHtml(text) {
  if (!text) return text;
  // まずXML無効文字を除去
  text = removeInvalidXmlChars(text);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createNote(row, scrapedContent = null) {
  const title = escapeHtml(row.title || row.url);
  const url = escapeHtml(row.url);
  const created = formatDate(row.time_added);
  const tags = row.tags ? row.tags.split(',').filter(tag => tag.trim()) : [];
  
  let contentHtml = '';
  
  if (scrapedContent) {
    // スクレイピング成功時 - XML無効文字を除去
    const cleanedContent = removeInvalidXmlChars(scrapedContent);
    contentHtml = `
<h1>${title}</h1>
<div>
<a href="${url}">Original Article</a>
</div>
<hr/>
<div>
${cleanedContent}
</div>
<hr/>
<div>
<small>
URL: ${url}<br/>
Status: ${escapeHtml(row.status)}<br/>
Scraped: ${new Date().toISOString().split('T')[0]}
</small>
</div>`;
  } else {
    // スクレイピングなし/失敗時
    contentHtml = `
<div>
<a href="${url}">${title}</a>
</div>
<div>
<br/>
</div>
<div>
URL: ${url}
</div>
<div>
Status: ${escapeHtml(row.status)}
</div>`;
  }
  
  const noteContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>
${contentHtml}
</en-note>`;

  const note = {
    title: title,
    content: noteContent,
    created: created,
    updated: created,
    'note-attributes': [{
      author: 'Pocket2Evernote',
      source: 'web.clip',
      'source-url': url
    }]
  };

  if (tags.length > 0) {
    note.tag = tags;
  }

  return note;
}

// 個別レコード処理（並列処理用）
async function processRecord(row, globalIndex, checkpoint, options) {
  let scrapedContent = null;
  let note = null;
  let success = true;
  
  try {
    if (options.scrape) {
      let scrapingMethod = 'lightweight';
      
      // 1段階目: 軽量スクレイピング
      scrapedContent = await scrapeContent(row.url);
      
      // 最終的な成功/失敗を判定
      const isScrapingSuccessful = scrapedContent && 
        !scrapedContent.includes('Failed to scrape') && 
        !scrapedContent.includes('Content could not be extracted');
      
      // 軽量スクレイピングが失敗した場合
      if (!isScrapingSuccessful) {
        // 進捗バー表示中はエラーログを抑制（統計で後で表示）
        success = false;
        
        // 2段階目: ヘッドレスブラウザフォールバック
        if (options.fallbackBrowser) {
          scrapedContent = await scrapeWithPuppeteer(row.url);
          scrapingMethod = 'browser';
          
          // ブラウザスクレイピング結果をチェック
          const isBrowserSuccessful = scrapedContent && 
            !scrapedContent.includes('Failed to scrape') && 
            !scrapedContent.includes('Content could not be extracted');
          
          if (isBrowserSuccessful) {
            success = true; // ブラウザで成功
          }
        }
      } else {
        success = true; // 軽量スクレイピングで成功
      }
      
      // スクレイピング手法の識別情報を追加
      if (scrapedContent && !scrapedContent.includes('Failed to scrape') && !scrapedContent.includes('Content could not be extracted')) {
        scrapedContent = addScrapingMethodInfo(scrapedContent, scrapingMethod);
      } else {
        scrapedContent = addScrapingMethodInfo(scrapedContent, 'failed');
        success = false;
      }
    }
    
    // ノート作成
    note = createNote(row, scrapedContent);
    
  } catch (error) {
    // 進捗バー表示中はエラーログを抑制（統計で後で表示）
    success = false;
    
    // エラーでも基本的なノートは作成
    try {
      note = createNote(row, null);
    } catch (noteError) {
      // エラーメッセージを抑制（進捗バーを中断しない）
      note = null;
    }
  }
  
  return { note, success };
}

async function convertCsvToEnex() {
  const limit = parseInt(options.limit || 999999);
  const batchSize = parseInt(options.batchSize || 10);
  
  // チェックポイント管理を初期化
  const checkpoint = new CheckpointManager(options.output, options);
  
  // レジューム機能のチェック
  let rows = [];
  let startIndex = 0;
  
  if (options.resume && checkpoint.hasCheckpoint()) {
    const savedProgress = checkpoint.loadCheckpoint();
    if (savedProgress) {
      startIndex = savedProgress.lastProcessedIndex + 1;
      console.log(`\nResuming from index ${startIndex}...`);
    }
  }

  // CSVを読み込み
  console.log('Loading CSV file...');
  let count = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(options.input)
      .pipe(csv())
      .on('data', (row) => {
        if (count < limit) {
          rows.push(row);
          count++;
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`Loaded ${rows.length} records from CSV`);
  
  // レジューム時は既に処理済みの部分をスキップ
  if (startIndex > 0) {
    rows = rows.slice(startIndex);
    console.log(`Skipping first ${startIndex} records (already processed)`);
  }

  // 進捗バー初期化
  let progressBar = null;
  const totalToProcess = rows.length;
  
  console.log(`\nStarting ${options.scrape ? 'scraping and ' : ''}conversion of ${totalToProcess} records...`);
  
  if (options.scrape && totalToProcess > 0) {
    progressBar = new cliProgress.SingleBar({
      format: 'Processing |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false
    });
    progressBar.start(totalToProcess, 0);
  }

  // チェックポイント初期化
  checkpoint.progress.totalCount = startIndex + rows.length;
  checkpoint.progress.processedCount = startIndex;

  // 真の並列処理でバッチ処理
  const results = [];
  
  for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, rows.length);
    const batch = rows.slice(batchStart, batchEnd);
    
    // バッチ処理開始（進捗バーは継続表示）
    
    // バッチ内並列処理：Promise.allで同時実行
    const batchPromises = batch.map(async (row, batchIndex) => {
      const globalIndex = startIndex + batchStart + batchIndex;
      
      return {
        originalIndex: globalIndex,
        result: await processRecord(row, globalIndex, checkpoint, options)
      };
    });
    
    try {
      // 並列実行して結果を取得
      const batchResults = await Promise.all(batchPromises);
      
      // CSV順序を維持：originalIndexでソート
      batchResults.sort((a, b) => a.originalIndex - b.originalIndex);
      
      // 結果を順序通りに追加
      for (const { originalIndex, result } of batchResults) {
        const { note, success } = result;
        
        if (note) {
          results.push(note);
        }
        
        // チェックポイント更新（順序通り）
        checkpoint.updateProgress(
          originalIndex + 1, 
          checkpoint.progress.totalCount, 
          originalIndex, 
          note,
          success ? null : `record_${originalIndex}`
        );
        
        // 個別進捗更新は行わない（バッチ処理のため）
      }
      
    } catch (error) {
      // バッチ処理エラーを抑制（進捗バーを中断しない）
      // バッチ失敗時も基本ノートを作成
      for (let i = 0; i < batch.length; i++) {
        const globalIndex = startIndex + batchStart + i;
        const row = batch[i];
        
        try {
          const note = createNote(row, null);
          results.push(note);
          checkpoint.updateProgress(globalIndex + 1, checkpoint.progress.totalCount, globalIndex, note, row.url);
          
        } catch (noteError) {
          // フォールバックノート作成エラーを抑制
          checkpoint.updateProgress(globalIndex + 1, checkpoint.progress.totalCount, globalIndex, null, row.url);
        }
      }
    }
    
    // バッチ完了後に進捗バー更新
    if (progressBar) {
      const currentProgress = Math.min(batchStart + batchSize, rows.length);
      progressBar.update(currentProgress);
    }
    
    // バッチ間のレート制限（サーバー負荷軽減）
    if (batchStart + batchSize < rows.length) {
      const delayMs = Math.max(1000, batchSize * 100); // batch-sizeに応じた遅延
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    // バッチ完了後のメモリクリーンアップ
    if (global.gc) {
      global.gc();
    }
  }

  // 最終進捗バー完了
  if (progressBar) {
    progressBar.update(totalToProcess);
    progressBar.stop();
    console.log(); // 改行
  }

  // 統計情報表示
  checkpoint.showStats();
  
  // 失敗したURLの表示
  if (checkpoint.progress.failedUrls.length > 0) {
    console.log(`\nWarning: Failed to scrape ${checkpoint.progress.failedUrls.length} URL(s):`);
    checkpoint.progress.failedUrls.slice(0, 10).forEach(url => console.log(`  - ${url}`));
    if (checkpoint.progress.failedUrls.length > 10) {
      console.log(`  ... and ${checkpoint.progress.failedUrls.length - 10} more`);
    }
  }

  // 最終ENEXファイル生成
  try {
    console.log(`\nGenerating final ENEX file with ${results.length} notes...`);
    
    // レジューム時は既存のノートも含める
    let allNotes = results;
    if (options.resume && checkpoint.progress.processedNotes.length > 0) {
      allNotes = [...checkpoint.progress.processedNotes, ...results];
      console.log(`Including ${checkpoint.progress.processedNotes.length} notes from checkpoint`);
    }
    
    const enexData = createEnexStructure(allNotes);
    
    const builder = new Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: {
        pretty: true,
        indent: '  '
      }
    });
    
    console.log('Building XML structure...');
    let xml;
    try {
      xml = builder.buildObject(enexData);
    } catch (xmlError) {
      console.error('Error building XML:', xmlError.message);
      
      // 問題のあるノートを特定して除外
      const validNotes = [];
      for (let i = 0; i < allNotes.length; i++) {
        try {
          const testData = createEnexStructure([allNotes[i]]);
          builder.buildObject(testData);
          validNotes.push(allNotes[i]);
        } catch (noteError) {
          console.error(`Skipping problematic note at index ${i}:`, allNotes[i].title);
          console.error('Error: XML parsing failed (invalid characters detected)');
        }
      }
      
      if (validNotes.length === 0) {
        throw new Error('No valid notes could be processed');
      }
      
      console.log(`Proceeding with ${validNotes.length} valid notes out of ${allNotes.length}`);
      const cleanEnexData = createEnexStructure(validNotes);
      xml = builder.buildObject(cleanEnexData);
    }
    
    console.log('Processing CDATA sections...');
    xml = xml.replace(/<content>(.+?)<\/content>/gs, (match, p1) => {
      const decodedContent = p1
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      return `<content>\n      <![CDATA[${decodedContent}]]>\n    </content>`;
    });
    
    console.log('Adding DOCTYPE declaration...');
    xml = xml.replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">'
    );
    
    console.log('Writing final ENEX file...');
    fs.writeFileSync(options.output, xml);
    
    // 成功時はチェックポイントファイルをクリーンアップ
    checkpoint.cleanup();
    
    const scrapingMsg = options.scrape ? ' with scraping' : '';
    console.log(`\n✅ Successfully converted ${checkpoint.progress.processedCount} entries to ${options.output}${scrapingMsg}`);
    console.log(`📊 Success rate: ${((checkpoint.progress.processedCount - checkpoint.progress.failedUrls.length) / checkpoint.progress.processedCount * 100).toFixed(1)}%`);
    
    // ブラウザクリーンアップ
    await browserManager.cleanup();
    
    // プロセスが確実に終了するまで待機
    console.log('Waiting for all resources to be released...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // すべてのタイマーとリスナーをクリア
    process.removeAllListeners();
    
    // macOSで残っているChromeプロセスを強制終了
    try {
      const { execSync } = require('child_process');
      execSync('pkill -f "Google Chrome for Testing" || true', { stdio: 'ignore' });
      console.log('Cleaned up any remaining Chrome processes');
    } catch (e) {
      // エラーは無視（プロセスが存在しない場合など）
    }
    
    console.log('Exiting process...');
    process.exit(0);
    
    return Promise.resolve();
    
  } catch (error) {
    console.error('\n❌ ENEX generation failed:', error.message);
    console.error('Stack trace:', error.stack);
    console.log('\n💾 Progress has been saved. Use --resume to continue from checkpoint.');
    
    // 最終チェックポイントを保存
    checkpoint.saveCheckpoint();
    
    // エラー時もブラウザクリーンアップ
    await browserManager.cleanup();
    
    // プロセスが確実に終了するまで待機
    console.log('Waiting for all resources to be released...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // すべてのタイマーとリスナーをクリア
    process.removeAllListeners();
    
    // macOSで残っているChromeプロセスを強制終了
    try {
      const { execSync } = require('child_process');
      execSync('pkill -f "Google Chrome for Testing" || true', { stdio: 'ignore' });
      console.log('Cleaned up any remaining Chrome processes');
    } catch (e) {
      // エラーは無視（プロセスが存在しない場合など）
    }
    
    console.log('Exiting process with error...');
    process.exit(1);
    
    return Promise.reject(error);
  }
}

// テスト用にモジュールとして実行されていない場合のみ実行
if (require.main === module) {
  convertCsvToEnex().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  }).finally(async () => {
    // 処理終了時にブラウザをクリーンアップ
    try {
      await browserManager.cleanup();
    } catch (error) {
      console.error('Final cleanup error:', error);
    }
  });
}

// テスト用にエクスポート
module.exports = {
  formatDate,
  detectEncoding,
  escapeHtml,
  removeInvalidXmlChars,
  createNote,
  createEnexStructure,
  scrapeContent,
  scrapeWithPuppeteer,
  addScrapingMethodInfo,
  convertCsvToEnex,
  CheckpointManager,
  processRecord,
  isBinaryUrl
};