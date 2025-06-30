#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

program
  .version('1.0.0')
  .description('Split large ENEX files into smaller chunks using regex-based parsing')
  .requiredOption('-i, --input <file>', 'Input ENEX file path')
  .requiredOption('-o, --output <directory>', 'Output directory path')
  .option('-n, --notes-per-file <number>', 'Number of notes per file', '1000')
  .parse(process.argv);

const options = program.opts();

function extractNotes(content) {
  // <note>...</note>タグを正規表現で抽出
  const noteRegex = /<note>[\s\S]*?<\/note>/g;
  const notes = content.match(noteRegex) || [];
  return notes;
}

function extractHeader(content) {
  // ヘッダー部分を抽出（最初の<note>タグまで）
  const firstNoteIndex = content.indexOf('<note>');
  if (firstNoteIndex === -1) {
    throw new Error('No <note> tags found in the file');
  }
  return content.substring(0, firstNoteIndex);
}

function extractFooter(content) {
  // フッター部分を抽出（最後の</note>タグ以降）
  const lastNoteIndex = content.lastIndexOf('</note>');
  if (lastNoteIndex === -1) {
    return '</en-export>';
  }
  return content.substring(lastNoteIndex + 7); // '</note>'.length = 7
}

async function splitEnexFile() {
  try {
    // 入力ファイルの存在確認
    if (!fs.existsSync(options.input)) {
      throw new Error(`Input file does not exist: ${options.input}`);
    }

    const stats = fs.statSync(options.input);
    console.log(`Reading ENEX file: ${options.input} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // ENEXファイルを読み込む
    console.log('Loading file into memory...');
    const enexContent = fs.readFileSync(options.input, 'utf8');
    
    console.log('Extracting notes using regex...');
    
    // ヘッダーとフッターを抽出
    let header, footer;
    try {
      header = extractHeader(enexContent);
      footer = extractFooter(enexContent);
    } catch (error) {
      console.error('Error extracting header/footer:', error.message);
      // デフォルトのヘッダー/フッターを使用
      header = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">\n<en-export export-date="' + new Date().toISOString() + '" application="Evernote" version="10.0">\n';
      footer = '\n</en-export>';
    }
    
    // ノートを抽出
    const notes = extractNotes(enexContent);
    const totalNotes = notes.length;
    console.log(`Found ${totalNotes} notes in the ENEX file`);
    
    if (totalNotes === 0) {
      throw new Error('No notes found in the ENEX file');
    }
    
    // 出力ディレクトリの作成
    if (!fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
      console.log(`Created output directory: ${options.output}`);
    }
    
    // ノート数の設定
    const notesPerFile = parseInt(options.notesPerFile);
    if (isNaN(notesPerFile) || notesPerFile <= 0) {
      throw new Error('Notes per file must be a positive number');
    }
    
    // ファイル分割処理
    const baseFilename = path.basename(options.input, '.enex');
    const totalFiles = Math.ceil(totalNotes / notesPerFile);
    console.log(`Splitting into ${totalFiles} files (${notesPerFile} notes per file)`);
    
    let processedNotes = 0;
    
    for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
      const startIndex = fileIndex * notesPerFile;
      const endIndex = Math.min(startIndex + notesPerFile, totalNotes);
      const notesChunk = notes.slice(startIndex, endIndex);
      
      // 新しいENEXファイルの内容を構築
      const chunkContent = header + notesChunk.join('\n') + footer;
      
      // ファイル名を生成
      const outputFilename = `${baseFilename}_part${String(fileIndex + 1).padStart(3, '0')}.enex`;
      const outputPath = path.join(options.output, outputFilename);
      
      // ファイルに書き込み
      fs.writeFileSync(outputPath, chunkContent, 'utf8');
      processedNotes += notesChunk.length;
      
      console.log(`Created ${outputFilename} (${notesChunk.length} notes, ${processedNotes}/${totalNotes} total)`);
    }
    
    console.log(`\n✅ Successfully split ${totalNotes} notes into ${totalFiles} files`);
    console.log(`📁 Output directory: ${path.resolve(options.output)}`);
    
    // メモリ使用量の情報
    const used = process.memoryUsage();
    console.log(`\nMemory usage: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// エラー処理を含めて実行
splitEnexFile().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});