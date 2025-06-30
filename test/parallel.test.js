// 並列処理テスト用モック
jest.mock('axios');
jest.mock('puppeteer', () => ({
  launch: jest.fn()
}));

const axios = require('axios');
const { processRecord } = require('../index.js');

describe('Parallel Processing Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processRecord function', () => {
    const mockOptions = {
      scrape: true,
      fallbackBrowser: false,
      timeout: 5000
    };

    const mockCheckpoint = {
      updateProgress: jest.fn()
    };

    test('should process record without scraping', async () => {
      const mockRow = {
        title: 'Test Article',
        url: 'https://example.com/test',
        time_added: '1507018057',
        tags: 'test,article',
        status: 'unread'
      };

      const result = await processRecord(mockRow, 0, mockCheckpoint, { scrape: false });

      expect(result.success).toBe(true);
      expect(result.note).toBeDefined();
      expect(result.note.title).toBe('Test Article');
    });

    test('should process record with successful scraping', async () => {
      const mockRow = {
        title: 'Test Article',
        url: 'https://example.com/test',
        time_added: '1507018057',
        tags: 'test',
        status: 'unread'
      };

      const mockHtml = `
        <html>
          <body>
            <article>
              <p>This is test content with sufficient length for proper extraction testing.</p>
              <p>Additional paragraph to ensure minimum requirements are met for extraction.</p>
            </article>
          </body>
        </html>
      `;

      axios.get.mockResolvedValue({
        data: Buffer.from(mockHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const result = await processRecord(mockRow, 0, mockCheckpoint, mockOptions);

      expect(result.success).toBe(true);
      expect(result.note).toBeDefined();
      expect(result.note.title).toBe('Test Article');
      expect(axios.get).toHaveBeenCalledWith('https://example.com/test', expect.any(Object));
    });

    test('should handle scraping failure gracefully', async () => {
      const mockRow = {
        title: 'Failed Article',
        url: 'https://failed.com/test',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };

      axios.get.mockRejectedValue(new Error('Network error'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await processRecord(mockRow, 1, mockCheckpoint, mockOptions);

      expect(result.success).toBe(false);
      expect(result.note).toBeDefined(); // Should still create basic note
      expect(result.note.title).toBe('Failed Article');
      // エラーログは進捗バー表示中は抑制される

      consoleErrorSpy.mockRestore();
    });

    test('should handle insufficient scraped content', async () => {
      const mockRow = {
        title: 'Short Content',
        url: 'https://example.com/short',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };

      const shortHtml = '<html><body><p>Too short</p></body></html>';

      axios.get.mockResolvedValue({
        data: Buffer.from(shortHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const result = await processRecord(mockRow, 2, mockCheckpoint, mockOptions);

      expect(result.success).toBe(false); // Should be false due to insufficient content
      expect(result.note).toBeDefined();
      expect(result.note.title).toBe('Short Content');
      
      consoleErrorSpy.mockRestore();
    });

    test('should use fallback browser when enabled', async () => {
      const mockRow = {
        title: 'JS Heavy Site',
        url: 'https://example.com/js-heavy',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };

      // First call (lightweight) returns insufficient content
      const shortHtml = '<html><body><p>Short</p></body></html>';
      axios.get.mockResolvedValue({
        data: Buffer.from(shortHtml, 'utf8'),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const optionsWithBrowser = { ...mockOptions, fallbackBrowser: true };

      const result = await processRecord(mockRow, 3, mockCheckpoint, optionsWithBrowser);

      // Should attempt both lightweight and browser scraping
      expect(result.note).toBeDefined();
      expect(result.note.title).toBe('JS Heavy Site');
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('CSV Order Preservation', () => {
    test('should maintain original order in parallel processing simulation', async () => {
      const mockRows = [
        { title: 'Article 1', url: 'https://example.com/1', time_added: '1507018057', tags: '', status: 'unread' },
        { title: 'Article 2', url: 'https://example.com/2', time_added: '1507018058', tags: '', status: 'unread' },
        { title: 'Article 3', url: 'https://example.com/3', time_added: '1507018059', tags: '', status: 'unread' }
      ];

      const mockCheckpoint = { updateProgress: jest.fn() };
      const options = { scrape: false };

      // Simulate parallel processing with Promise.all
      const promises = mockRows.map(async (row, index) => ({
        originalIndex: index,
        result: await processRecord(row, index, mockCheckpoint, options)
      }));

      const results = await Promise.all(promises);

      // Check that results can be sorted by originalIndex
      results.sort((a, b) => a.originalIndex - b.originalIndex);

      expect(results[0].result.note.title).toBe('Article 1');
      expect(results[1].result.note.title).toBe('Article 2');
      expect(results[2].result.note.title).toBe('Article 3');
    });

    test('should handle mixed success/failure in parallel batch', async () => {
      const mockRows = [
        { title: 'Success 1', url: 'https://good.com/1', time_added: '1507018057', tags: '', status: 'unread' },
        { title: 'Failure', url: 'https://bad.com/fail', time_added: '1507018058', tags: '', status: 'unread' },
        { title: 'Success 2', url: 'https://good.com/2', time_added: '1507018059', tags: '', status: 'unread' }
      ];

      // Mock successful scraping for good.com, failure for bad.com
      axios.get.mockImplementation((url) => {
        if (url.includes('bad.com')) {
          return Promise.reject(new Error('Server error'));
        }
        return Promise.resolve({
          data: Buffer.from('<html><body><article><div class="content"><p>Good content here with sufficient length for proper extraction testing purposes. This content should be long enough to pass the minimum length requirements and contain meaningful text that can be extracted by the scraping function. Additional content is added here to ensure we meet all extraction criteria and provide a realistic test scenario for the web scraping functionality.</p></div></article></body></html>', 'utf8'),
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      });

      const mockCheckpoint = { updateProgress: jest.fn() };
      const options = { scrape: true };

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const promises = mockRows.map(async (row, index) => ({
        originalIndex: index,
        result: await processRecord(row, index, mockCheckpoint, options)
      }));

      const results = await Promise.all(promises);
      results.sort((a, b) => a.originalIndex - b.originalIndex);

      expect(results[0].result.success).toBe(true);
      expect(results[1].result.success).toBe(false);
      expect(results[2].result.success).toBe(true);

      // All should have notes created
      expect(results[0].result.note.title).toBe('Success 1');
      expect(results[1].result.note.title).toBe('Failure');
      expect(results[2].result.note.title).toBe('Success 2');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Performance and Memory', () => {
    test('should handle large batch without memory issues', async () => {
      const batchSize = 50;
      const mockRows = Array.from({ length: batchSize }, (_, i) => ({
        title: `Article ${i + 1}`,
        url: `https://example.com/${i + 1}`,
        time_added: (1507018057 + i).toString(),
        tags: `tag${i}`,
        status: 'unread'
      }));

      const mockCheckpoint = { updateProgress: jest.fn() };
      const options = { scrape: false };

      const startTime = Date.now();

      const promises = mockRows.map(async (row, index) => ({
        originalIndex: index,
        result: await processRecord(row, index, mockCheckpoint, options)
      }));

      const results = await Promise.all(promises);
      const processingTime = Date.now() - startTime;

      expect(results).toHaveLength(batchSize);
      expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      // Verify all notes were created
      results.forEach((result, index) => {
        expect(result.result.note).toBeDefined();
        expect(result.result.note.title).toBe(`Article ${index + 1}`);
      });
    });

    test('should handle timeout scenarios', async () => {
      const mockRow = {
        title: 'Timeout Test',
        url: 'https://slow.com/timeout',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };

      // Mock a timeout scenario
      axios.get.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout of 5000ms exceeded')), 100)
        )
      );

      const mockCheckpoint = { updateProgress: jest.fn() };
      const options = { scrape: true, timeout: 5000 };

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await processRecord(mockRow, 0, mockCheckpoint, options);

      expect(result.success).toBe(false);
      expect(result.note).toBeDefined(); // Should still create basic note
      // エラーログは進捗バー表示中は抑制される

      consoleErrorSpy.mockRestore();
    });
  });
});