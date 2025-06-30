# pocket2evernote

🌐 Available Languages: [English](README.md) | [日本語](README_ja.md)

A command-line tool to convert Pocket CSV export files to Evernote ENEX format with advanced web scraping capabilities.

## Features

- 🔄 **Basic Conversion**: Convert Pocket CSV to Evernote ENEX format
- 🕷️ **Web Scraping**: Extract full article content, enabling full-text search in Evernote
- 🔍 **Full-Text Search**: Scraped content is fully searchable within Evernote
- 🚀 **Dual Scraping Methods**: Lightweight HTTP + headless browser fallback
- ⚡ **Parallel Processing**: Process multiple URLs simultaneously (up to 20x faster)
- 💾 **Checkpoint System**: Auto-save progress every 100 records, resume from interruptions
- 📊 **Progress Tracking**: Real-time progress bar with ETA during scraping
- 🏷️ **Method Identification**: Track which scraping method was used
- 📝 **ENML Compliant**: Generated content displays correctly in Evernote
- 🔪 **File Splitting**: Split large ENEX files for reliable Evernote import (500 notes recommended)

## Installation

```bash
npm install
npm link
```

## Usage

### Basic Usage (URL-only conversion)

```bash
pocket2evernote -i pocket_export.csv -o output.enex
```

### Advanced Usage (with web scraping)

```bash
# Lightweight scraping only (faster)
pocket2evernote -i pocket_export.csv -o output.enex --scrape

# With headless browser fallback (comprehensive)
pocket2evernote -i pocket_export.csv -o output.enex --scrape --fallback-browser
```

## Options

- `-i, --input <file>`: Input CSV file path (required)
- `-o, --output <file>`: Output ENEX file path (required)
- `-l, --limit <number>`: Limit number of records to convert (default: all records)
- `-s, --scrape`: Enable web scraping to extract full article content
- `-t, --timeout <number>`: Scraping timeout in milliseconds (default: 7000)
- `--fallback-browser`: Use headless browser as fallback when lightweight scraping fails
- `--resume`: Resume from previous checkpoint (automatically saves progress)
- `--checkpoint-interval <number>`: Save checkpoint every N records (default: 100)
- `--batch-size <number>`: Process N records in parallel per batch (default: 10)

## Examples

```bash
# Convert all entries with scraping (recommended for large datasets)
pocket2evernote -i pocket_export.csv -o output.enex --scrape --fallback-browser

# Convert with checkpoints every 50 records (safe for large datasets)
pocket2evernote -i pocket_export.csv -o output.enex --scrape --checkpoint-interval 50

# Resume from previous run if it was interrupted
pocket2evernote -i pocket_export.csv -o output.enex --scrape --resume

# High-speed parallel processing (20 URLs simultaneously)
pocket2evernote -i pocket_export.csv -o output.enex --scrape --batch-size 20

# Conservative parallel processing (5 URLs simultaneously)
pocket2evernote -i pocket_export.csv -o output.enex --scrape --batch-size 5

# Basic conversion without scraping (fastest)
pocket2evernote -i pocket_export.csv -o output.enex
```

## Web Scraping

### Scraping Methods

The tool uses a **two-stage scraping approach**:

1. **Lightweight HTTP Scraping** (axios + cheerio): Fast, works with static content
2. **Headless Browser Scraping** (Puppeteer): Slower but handles JavaScript-heavy sites

### Method Identification

Each scraped note includes an identification label:
- `[Scraped via HTTP]`: Successfully scraped using lightweight method
- `[Scraped via Browser]`: Successfully scraped using headless browser
- `[Scraping Failed]`: Both methods failed

### Performance

- **Processing Speed**: 
  - Basic conversion: Instant (no scraping)
  - With scraping: ~1-2 seconds per URL (includes rate limiting)
  - Parallel processing: Up to 20x faster with batch processing
- **Success Rate**: Typically 80-90% with dual-method approach
- **Memory Usage**: Optimized with batch processing and automatic garbage collection
- **Browser Management**: Automatic cleanup prevents Chrome process accumulation

## Large Dataset Processing

For processing thousands of records safely:

### Checkpoint System
- **Automatic Saves**: Progress saved every 100 records (configurable)
- **Resume Capability**: Continue from last checkpoint with `--resume`
- **Intermediate Files**: Partial ENEX files saved during processing
- **Crash Recovery**: Never lose hours of processing work

### Parallel Processing Optimization
- **True Parallel Processing**: Process multiple URLs simultaneously within each batch
- **Batch Size Control**: Configure parallel processing intensity (default: 10 simultaneous)
- **Memory Cleanup**: Automatic garbage collection between batches
- **Server-Friendly Rate Limiting**: Intelligent delays between batches based on batch size

### Example: 9000 Records
```bash
# Initial run (will create checkpoints automatically)
pocket2evernote -i large_export.csv -o output.enex --scrape --fallback-browser --checkpoint-interval 100

# If interrupted, resume from checkpoint
pocket2evernote -i large_export.csv -o output.enex --scrape --fallback-browser --resume

# For conservative server load (5 parallel URLs, frequent checkpoints)
pocket2evernote -i large_export.csv -o output.enex --scrape --batch-size 5 --checkpoint-interval 50

# For high-speed processing (20 parallel URLs)
pocket2evernote -i large_export.csv -o output.enex --scrape --batch-size 20

# With fallback browser (recommended smaller batch size)
pocket2evernote -i large_export.csv -o output.enex --scrape --fallback-browser --batch-size 20
```

## Splitting Large ENEX Files

⚠️ **Important**: Evernote may have issues importing ENEX files with more than 500-1000 notes at once. Files with thousands of notes can cause the import process to hang or fail. Use the `split-enex` command to split large ENEX files into smaller, manageable chunks:

### Usage

```bash
split-enex -i input.enex -o output_folder -n 1000
```

### Options

- `-i, --input <file>`: Input ENEX file path (required)
- `-o, --output <directory>`: Output directory path (required, created if not exists)
- `-n, --notes-per-file <number>`: Number of notes per file (default: 1000)

### Example

```bash
# Split a 9000-note ENEX file into 9 files with 1000 notes each
split-enex -i output_full.enex -o split_output -n 1000

# Split into smaller chunks of 500 notes each
split-enex -i output_full.enex -o split_output -n 500
```

The split files will be named: `original_name_part001.enex`, `original_name_part002.enex`, etc.

## Important Notes

### Evernote Import Limitations

- **File Size**: Evernote struggles with ENEX files containing more than 500-1000 notes
- **Import Process**: Large files may cause Evernote to hang during import
- **Recommendation**: Use `split-enex` to create files with 500 notes each for reliable imports
- **Multiple Imports**: You can import multiple ENEX files sequentially without issues

### Notebook Organization

**Evernote does not support notebook specification in ENEX format.** This is a limitation of the ENEX format itself, not this tool.

When you import the generated ENEX file into Evernote:
- All notes will be placed in an automatically created notebook named "(Imported) [filename]"
- You will need to manually organize the notes into your desired notebooks after import
- This behavior is consistent with all ENEX import operations in Evernote

### Full-Text Search

With web scraping enabled, the generated ENEX files contain the full article content, making them **fully searchable within Evernote**. This is the primary benefit of using the scraping feature.

### CSV Format

The tool expects Pocket's standard CSV export format:

```csv
title,url,time_added,tags,status
Article Title,https://example.com/article,1507018057,tag1,tag2,unread
```

### Generated Content

#### Without Scraping
Each note contains:
- **Title**: The article title from Pocket (or URL if no title)
- **Content**: A clickable link to the original URL, plus URL and status information
- **Tags**: Original tags from Pocket (if any)
- **Created/Updated dates**: Based on the `time_added` timestamp from Pocket
- **Source URL**: The original URL for reference

#### With Scraping
Each note additionally contains:
- **Full Article Content**: Extracted and cleaned article text
- **Method Identification**: Label indicating which scraping method was used
- **Scraping Date**: When the content was extracted

## Requirements

- Node.js 14 or higher
- npm
- Internet connection (for web scraping)

## Testing

Run the comprehensive test suite to ensure reliability:

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

The test suite includes:
- **Unit Tests**: Core functionality validation
- **Integration Tests**: Component interaction verification  
- **Performance Tests**: Large dataset handling (1000+ records)
- **Edge Case Tests**: Special characters, encoding, error handling

Test coverage: ~44% with focus on critical XML processing and data integrity.

## Troubleshooting

### Chrome Processes Remaining After Execution
- The tool automatically cleans up Chrome processes on exit
- If processes remain, they will be force-killed at the end of execution
- Manual cleanup: `pkill -f "Google Chrome for Testing"`

### High Failure Rate
- Use `--fallback-browser` option for better success rate
- Increase timeout with `-t 15000` for slow sites
- Some sites may block automated access entirely

### Memory Issues
- Reduce batch size with `--batch-size 5` for lower memory usage
- Use checkpoint system to process in smaller chunks
- Close other applications during large scraping operations

### Rate Limiting
- Built-in intelligent delays between batches (1-2 seconds)
- Adjust batch size to control request rate
- Some sites may require manual intervention for large volumes

### Import Hanging in Evernote
- Split files to 500 notes or less using `split-enex`
- Import files one at a time
- Wait for each import to complete before starting the next

## License

MIT

## Contributing

Issues and pull requests are welcome on GitHub.

---

**日本語のREADMEは[README_ja.md](README_ja.md)をご覧ください。**