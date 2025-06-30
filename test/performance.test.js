const fs = require('fs');
const path = require('path');
const {
  createNote,
  createEnexStructure
} = require('../index.js');
const { Builder } = require('xml2js');

describe('Performance Tests', () => {
  describe('Large Dataset Handling', () => {
    test('should handle 1000 notes without memory issues', () => {
      const notes = [];
      const startTime = Date.now();
      
      // 1000個のモックノートを生成
      for (let i = 0; i < 1000; i++) {
        const mockRow = {
          title: `Test Article ${i}`,
          url: `https://example.com/article/${i}`,
          time_added: '1507018057',
          tags: `tag${i},category${i % 10}`,
          status: 'unread'
        };
        
        const mockContent = `<p>This is test content for article ${i}. `.repeat(10) + '</p>';
        const note = createNote(mockRow, mockContent);
        notes.push(note);
      }
      
      const processingTime = Date.now() - startTime;
      expect(notes).toHaveLength(1000);
      expect(processingTime).toBeLessThan(5000); // 5秒以内で完了
    });

    test('should create valid ENEX for large dataset', () => {
      const notes = [];
      
      // 100個のノートで ENEX 生成テスト
      for (let i = 0; i < 100; i++) {
        const mockRow = {
          title: `Large Dataset Article ${i}`,
          url: `https://example.com/large/${i}`,
          time_added: (1507018057 + i).toString(),
          tags: `performance,test,item${i}`,
          status: 'unread'
        };
        
        const note = createNote(mockRow);
        notes.push(note);
      }
      
      const enexData = createEnexStructure(notes);
      
      expect(enexData['en-export'].note).toHaveLength(100);
      expect(enexData['en-export'].$).toBeDefined();
      expect(enexData['en-export'].$.application).toBe('Evernote');
    });

    test('should handle memory-intensive content', () => {
      const largeContent = 'x'.repeat(100000); // 100KB content
      const mockRow = {
        title: 'Memory Test Article',
        url: 'https://example.com/memory-test',
        time_added: '1507018057',
        tags: 'memory,performance',
        status: 'unread'
      };
      
      const note = createNote(mockRow, largeContent);
      
      expect(note.content).toContain(largeContent);
      expect(note.content.length).toBeGreaterThan(100000);
    });
  });

  describe('XML Generation Performance', () => {
    test('should generate XML for large dataset within time limit', () => {
      const notes = [];
      
      // 500個のノートでXML生成パフォーマンステスト
      for (let i = 0; i < 500; i++) {
        const mockRow = {
          title: `XML Performance Test ${i}`,
          url: `https://example.com/xml-perf/${i}`,
          time_added: '1507018057',
          tags: 'xml,performance',
          status: 'unread'
        };
        
        const note = createNote(mockRow);
        notes.push(note);
      }
      
      const startTime = Date.now();
      const enexData = createEnexStructure(notes);
      
      const builder = new Builder({
        xmldec: { version: '1.0', encoding: 'UTF-8' },
        renderOpts: {
          pretty: true,
          indent: '  '
        }
      });
      
      const xml = builder.buildObject(enexData);
      const processingTime = Date.now() - startTime;
      
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<en-export');
      expect(processingTime).toBeLessThan(10000); // 10秒以内で完了
    });
  });

  describe('Edge Case Stress Tests', () => {
    test('should handle extremely long titles', () => {
      const extremelyLongTitle = 'Very Long Title '.repeat(1000);
      const mockRow = {
        title: extremelyLongTitle,
        url: 'https://example.com/long-title',
        time_added: '1507018057',
        tags: 'stress,test',
        status: 'unread'
      };
      
      const note = createNote(mockRow);
      
      expect(note.title).toContain('Very Long Title');
      expect(note.title.length).toBeGreaterThan(1000);
    });

    test('should handle special characters in bulk', () => {
      const specialChars = '<>&"\'\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0B\x0C\x0E\x0F';
      const notes = [];
      
      for (let i = 0; i < 100; i++) {
        const mockRow = {
          title: `Special Test ${i} ${specialChars}`,
          url: `https://example.com/special/${i}?param=${specialChars}`,
          time_added: '1507018057',
          tags: `special${specialChars},test`,
          status: 'unread'
        };
        
        const note = createNote(mockRow);
        notes.push(note);
      }
      
      const enexData = createEnexStructure(notes);
      expect(enexData['en-export'].note).toHaveLength(100);
      
      // 特殊文字が適切にエスケープされていることを確認
      notes.forEach(note => {
        expect(note.title).not.toContain('<script>');
        expect(note.title).toContain('&lt;');
      });
    });

    test('should handle mixed encoding scenarios', () => {
      const testCases = [
        'ASCII text only',
        'UTF-8 with émojis 🎉',
        '日本語テキスト',
        'Русский текст',
        '中文测试',
        '한국어 테스트'
      ];
      
      const notes = testCases.map((title, i) => {
        const mockRow = {
          title: title,
          url: `https://example.com/encoding/${i}`,
          time_added: '1507018057',
          tags: 'encoding,international',
          status: 'unread'
        };
        
        return createNote(mockRow);
      });
      
      const enexData = createEnexStructure(notes);
      expect(enexData['en-export'].note).toHaveLength(testCases.length);
      
      // 各言語の文字が保持されていることを確認
      expect(notes[1].title).toContain('🎉');
      expect(notes[2].title).toContain('日本語');
      expect(notes[3].title).toContain('Русский');
      expect(notes[4].title).toContain('中文');
      expect(notes[5].title).toContain('한국어');
    });
  });
});