const {
  formatDate,
  detectEncoding,
  escapeHtml,
  createNote,
  createEnexStructure,
  addScrapingMethodInfo
} = require('../index.js');

describe('Unit Tests', () => {
  describe('formatDate', () => {
    test('should format unix timestamp correctly', () => {
      const timestamp = 1507018057; // 2017-10-03T09:07:37Z
      const result = formatDate(timestamp);
      expect(result).toMatch(/^20171003T\d{6}Z$/); // タイムゾーンに依存しない
    });

    test('should handle string timestamp', () => {
      const timestamp = '1507018057';
      const result = formatDate(timestamp);
      expect(result).toMatch(/^20171003T\d{6}Z$/); // タイムゾーンに依存しない
    });

    test('should handle zero timestamp', () => {
      const timestamp = 0;
      const result = formatDate(timestamp);
      expect(result).toMatch(/^19700101T\d{6}Z$/); // タイムゾーンに依存しない
    });

    test('should return valid date format', () => {
      const timestamp = 1507018057;
      const result = formatDate(timestamp);
      expect(result).toMatch(/^\d{8}T\d{6}Z$/); // YYYYMMDDTHHMMSSZ format
    });
  });

  describe('detectEncoding', () => {
    test('should detect EUC-JP encoding', () => {
      const buffer = Buffer.from('charset=EUC-JP');
      const result = detectEncoding(buffer);
      expect(result).toBe('euc-jp');
    });

    test('should detect Shift_JIS encoding', () => {
      const buffer = Buffer.from('charset=Shift_JIS');
      const result = detectEncoding(buffer);
      expect(result).toBe('shift_jis');
    });

    test('should default to utf8', () => {
      const buffer = Buffer.from('normal text');
      const result = detectEncoding(buffer);
      expect(result).toBe('utf8');
    });
  });

  describe('escapeHtml', () => {
    test('should escape HTML special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const result = escapeHtml(input);
      expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    test('should escape ampersand', () => {
      const input = 'Tom & Jerry';
      const result = escapeHtml(input);
      expect(result).toBe('Tom &amp; Jerry');
    });

    test('should escape single quotes', () => {
      const input = "It's a test";
      const result = escapeHtml(input);
      expect(result).toBe('It&#39;s a test');
    });

    test('should handle empty string', () => {
      const input = '';
      const result = escapeHtml(input);
      expect(result).toBe('');
    });

    test('should handle complex mixed characters', () => {
      const input = 'Article with <HTML> & "quotes" & \'apostrophe\'';
      const result = escapeHtml(input);
      expect(result).toBe('Article with &lt;HTML&gt; &amp; &quot;quotes&quot; &amp; &#39;apostrophe&#39;');
    });
  });

  describe('createNote', () => {
    const mockRow = {
      title: 'Test Article',
      url: 'https://example.com/test',
      time_added: '1507018057',
      tags: 'tag1,tag2,tag3',
      status: 'unread'
    };

    test('should create note without scraping', () => {
      const result = createNote(mockRow);
      
      expect(result.title).toBe('Test Article');
      expect(result['note-attributes'][0]['source-url']).toBe('https://example.com/test');
      expect(result.tag).toEqual(['tag1', 'tag2', 'tag3']);
      expect(result.content).toContain('Test Article');
      expect(result.content).toContain('https://example.com/test');
    });

    test('should create note with scraping content', () => {
      const mockScrapedContent = '<p>This is scraped content</p>';
      const result = createNote(mockRow, mockScrapedContent);
      
      expect(result.content).toContain('This is scraped content');
      expect(result.content).toContain('Original Article');
    });

    test('should handle special characters in title and URL', () => {
      const specialRow = {
        title: 'Article with <HTML> & "quotes"',
        url: 'https://example.com/test?param=value&other=data',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };
      
      const result = createNote(specialRow);
      expect(result.title).toBe('Article with &lt;HTML&gt; &amp; &quot;quotes&quot;');
      expect(result.content).toContain('&lt;HTML&gt; &amp; &quot;quotes&quot;');
    });

    test('should handle empty title by using URL', () => {
      const noTitleRow = {
        title: '',
        url: 'https://example.com/test',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };
      
      const result = createNote(noTitleRow);
      expect(result.title).toBe('https://example.com/test');
    });

    test('should handle empty tags', () => {
      const noTagsRow = {
        title: 'Test',
        url: 'https://example.com/test',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };
      
      const result = createNote(noTagsRow);
      expect(result.tag).toBeUndefined();
    });
  });

  describe('createEnexStructure', () => {
    test('should create valid ENEX structure', () => {
      const mockNotes = [
        {
          title: 'Test Note',
          content: '<en-note>Test content</en-note>',
          created: '20171003T090737Z',
          updated: '20171003T090737Z',
          'note-attributes': [{ author: 'test' }]
        }
      ];
      
      const result = createEnexStructure(mockNotes);
      
      expect(result['en-export']).toBeDefined();
      expect(result['en-export'].$).toBeDefined();
      expect(result['en-export'].$.application).toBe('Evernote');
      expect(result['en-export'].$.version).toBe('10.0');
      expect(result['en-export'].note).toEqual(mockNotes);
    });

    test('should handle empty notes array', () => {
      const result = createEnexStructure([]);
      expect(result['en-export'].note).toEqual([]);
    });
  });

  describe('addScrapingMethodInfo', () => {
    test('should add HTTP method label', () => {
      const content = '<p>Test content</p>';
      const result = addScrapingMethodInfo(content, 'lightweight');
      expect(result).toContain('[Scraped via HTTP]');
    });

    test('should add Browser method label', () => {
      const content = '<p>Test content</p>';
      const result = addScrapingMethodInfo(content, 'browser');
      expect(result).toContain('[Scraped via Browser]');
    });

    test('should add Failed label for failed content', () => {
      const content = '<p>Failed to scrape content from https://example.com</p>';
      const result = addScrapingMethodInfo(content, 'failed');
      expect(result).toContain('[Scraping Failed]');
    });

    test('should add Failed label for could not extract content', () => {
      const content = '<p>Content could not be extracted from https://example.com</p>';
      const result = addScrapingMethodInfo(content, 'failed');
      expect(result).toContain('[Scraping Failed]');
    });

    test('should handle empty content', () => {
      const result = addScrapingMethodInfo('', 'lightweight');
      expect(result).toBe('');
    });
  });
});

describe('Integration Tests', () => {
  describe('XML Escape Issue Reproduction', () => {
    test('should handle problematic XML escaping correctly', () => {
      const problematicRow = {
        title: 'Article with <HTML> & "quotes"',
        url: 'http://togetter.com/li/240822',
        time_added: '1507018057',
        tags: 'web,html',
        status: 'unread'
      };
      
      const problematicContent = '<p><small>[Scraped via HTTP]</small></p>';
      const scrapedContent = addScrapingMethodInfo(problematicContent, 'lightweight');
      
      const note = createNote(problematicRow, scrapedContent);
      const notes = [note];
      const enexData = createEnexStructure(notes);
      
      // XML構造が正しく生成されることを確認
      expect(enexData['en-export'].note).toHaveLength(1);
      expect(enexData['en-export'].note[0].title).toBe('Article with &lt;HTML&gt; &amp; &quot;quotes&quot;');
      expect(enexData['en-export'].note[0].content).toContain('[Scraped via HTTP]');
    });
  });

  describe('Edge Cases', () => {
    test('should handle extremely long content', () => {
      const longContent = 'a'.repeat(10000);
      const row = {
        title: 'Long Article',
        url: 'https://example.com/long',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };
      
      const result = createNote(row, longContent);
      expect(result.content).toContain(longContent);
    });

    test('should handle Japanese characters', () => {
      const japaneseRow = {
        title: 'テスト記事',
        url: 'https://example.com/日本語',
        time_added: '1507018057',
        tags: 'テスト,日本語',
        status: 'unread'
      };
      
      const result = createNote(japaneseRow);
      expect(result.title).toBe('テスト記事');
      expect(result.tag).toEqual(['テスト', '日本語']);
    });

    test('should handle emoji in content', () => {
      const emojiRow = {
        title: 'Emoji Article 😀🎉',
        url: 'https://example.com/emoji',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };
      
      const result = createNote(emojiRow);
      expect(result.title).toBe('Emoji Article 😀🎉');
    });

    test('should handle malformed URLs', () => {
      const malformedRow = {
        title: 'Bad URL',
        url: 'not-a-valid-url',
        time_added: '1507018057',
        tags: '',
        status: 'unread'
      };
      
      const result = createNote(malformedRow);
      expect(result.title).toBe('Bad URL');
      expect(result['note-attributes'][0]['source-url']).toBe('not-a-valid-url');
    });
  });
});