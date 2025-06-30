// モック設定
jest.mock('axios');
jest.mock('fs');
jest.mock('csv-parser');
jest.mock('puppeteer', () => ({
  launch: jest.fn()
}));
jest.mock('cli-progress', () => ({
  SingleBar: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    update: jest.fn(),
    stop: jest.fn()
  }))
}));

const axios = require('axios');
const fs = require('fs');
const {
  detectEncoding,
  addScrapingMethodInfo,
  scrapeContent
} = require('../index.js');

describe('Coverage Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectEncoding', () => {
    test('should detect various encodings', () => {
      // EUC-JP lowercase
      let buffer = Buffer.from('charset=euc-jp');
      expect(detectEncoding(buffer)).toBe('euc-jp');

      // Shift_JIS lowercase
      buffer = Buffer.from('charset=shift_jis');
      expect(detectEncoding(buffer)).toBe('shift_jis');

      // Mixed case - detectEncoding is case sensitive
      buffer = Buffer.from('charset=EUC-JP');
      expect(detectEncoding(buffer)).toBe('euc-jp');

      // No charset
      buffer = Buffer.from('normal html content');
      expect(detectEncoding(buffer)).toBe('utf8');
    });
  });

  describe('addScrapingMethodInfo edge cases', () => {
    test('should handle null content', () => {
      const result = addScrapingMethodInfo(null, 'lightweight');
      expect(result).toBeNull();
    });

    test('should handle undefined content', () => {
      const result = addScrapingMethodInfo(undefined, 'lightweight');
      expect(result).toBeUndefined();
    });

    test('should handle different failure patterns', () => {
      // "Failed to scrape" pattern
      let content = '<p>Failed to scrape content from https://example.com: timeout</p>';
      let result = addScrapingMethodInfo(content, 'failed');
      expect(result).toContain('[Scraping Failed]');

      // "Content could not be extracted" pattern
      content = '<p>Content could not be extracted from https://example.com</p>';
      result = addScrapingMethodInfo(content, 'failed');
      expect(result).toContain('[Scraping Failed]');
    });

    test('should handle successful content with different methods', () => {
      const content = '<p>This is successful content</p>';
      
      let result = addScrapingMethodInfo(content, 'lightweight');
      expect(result).toContain('[Scraped via HTTP]');

      result = addScrapingMethodInfo(content, 'browser');
      expect(result).toContain('[Scraped via Browser]');
    });
  });

  describe('scrapeContent with mocked axios', () => {
    test('should handle successful content extraction', async () => {
      const validContent = `
        <html>
          <body>
            <article>
              <p>This is a test article with sufficient content length for proper extraction.</p>
              <p>Additional paragraph to ensure we meet the minimum character requirements.</p>
              <p>Even more content to guarantee successful extraction and processing.</p>
            </article>
          </body>
        </html>
      `;

      axios.get.mockResolvedValue({
        data: Buffer.from(validContent, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await scrapeContent('https://example.com/valid');
      expect(result).toContain('test article');
      expect(result).toContain('<p>');
    });

    test('should handle content extraction failure', async () => {
      const shortContent = '<html><body><p>Too short</p></body></html>';

      axios.get.mockResolvedValue({
        data: Buffer.from(shortContent, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await scrapeContent('https://example.com/short');
      expect(result).toContain('Content could not be extracted');
    });

    test('should handle axios error', async () => {
      axios.get.mockRejectedValue(new Error('Network timeout'));

      const result = await scrapeContent('https://example.com/timeout');
      expect(result).toContain('Failed to scrape content');
      expect(result).toContain('Network timeout');
    });

    test('should handle various content selectors', async () => {
      const complexHtml = `
        <html>
          <body>
            <script>bad script</script>
            <style>bad style</style>
            <nav class="navigation">nav content</nav>
            <aside class="sidebar">sidebar</aside>
            <div class="ads">advertisement</div>
            <main>
              <div class="article-content">
                <p>This is the main article content that should be extracted properly.</p>
                <p>Additional content to ensure we meet the minimum length requirements.</p>
                <p>Even more content to make sure the extraction works as expected.</p>
              </div>
            </main>
          </body>
        </html>
      `;

      axios.get.mockResolvedValue({
        data: Buffer.from(complexHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await scrapeContent('https://example.com/complex');
      
      expect(result).toContain('main article content');
      expect(result).not.toContain('bad script');
      expect(result).not.toContain('bad style');
      expect(result).not.toContain('nav content');
      expect(result).not.toContain('sidebar');
      expect(result).not.toContain('advertisement');
    });

    test('should handle fallback content selection', async () => {
      const fallbackHtml = `
        <html>
          <body>
            <div>
              <p>This content doesn't match the primary selectors.</p>
              <p>But it should be found by the fallback mechanism because it's long enough.</p>
              <p>Additional text to ensure we meet the minimum character requirements for extraction.</p>
            </div>
          </body>
        </html>
      `;

      axios.get.mockResolvedValue({
        data: Buffer.from(fallbackHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await scrapeContent('https://example.com/fallback');
      expect(result).toContain('fallback mechanism');
    });
  });

  describe('Content formatting and ENML conversion', () => {
    test('should handle content with various paragraph breaks', async () => {
      const multiParagraphHtml = `
        <html>
          <body>
            <article>
              <p>First paragraph with enough content for extraction testing purposes.</p>
              <p>Second paragraph: This format shows how content gets divided properly.</p>
              <p>Third paragraph■Important points are included in this content section.</p>
              <p>Additional paragraph provides more content to meet requirements.</p>
            </article>
          </body>
        </html>
      `;

      axios.get.mockResolvedValue({
        data: Buffer.from(multiParagraphHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await scrapeContent('https://example.com/paragraphs');
      
      // ENML形式の段落タグが生成されることを確認
      expect(result).toContain('<p>');
      expect(result).toContain('</p>');
      expect(result).toContain('First paragraph');
    });

    test('should handle special characters in content', async () => {
      const specialCharHtml = `
        <html>
          <body>
            <article>
              <p>Content with special characters: &lt;test&gt; &amp; "quotes" and 'apostrophes'.</p>
              <p>More content to ensure minimum length requirements are met for proper extraction.</p>
            </article>
          </body>
        </html>
      `;

      axios.get.mockResolvedValue({
        data: Buffer.from(specialCharHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await scrapeContent('https://example.com/special');
      
      // 特殊文字が適切にエスケープされることを確認
      expect(result).toContain('&amp;');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });
  });
});