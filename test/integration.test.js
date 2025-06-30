// Mock外部依存関係（requireより前に）
jest.mock('axios');
jest.mock('fs');
jest.mock('csv-parser');
jest.mock('puppeteer', () => ({
  launch: jest.fn()
}));

const axios = require('axios');
const fs = require('fs');

// 関数を個別にテストするため、直接インポート
const { escapeHtml, formatDate, createNote, createEnexStructure } = require('../index.js');

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Core Function Integration', () => {
    test('should integrate escapeHtml with createNote correctly', () => {
      const specialRow = {
        title: 'Article with <script>alert("XSS")</script> & special chars',
        url: 'https://example.com/special?param=<value>&other="quoted"',
        time_added: '1507018057',
        tags: 'test,<script>,special',
        status: 'unread'
      };
      
      const note = createNote(specialRow);
      
      // HTMLエスケープが正しく適用されていることを確認
      expect(note.title).toContain('&lt;script&gt;');
      expect(note.title).toContain('&amp;');
      expect(note.title).toContain('&quot;');
      expect(note.content).toContain('&lt;script&gt;');
      expect(note.content).not.toContain('<script>alert');
    });

    test('should create valid ENEX structure with escaped content', () => {
      const problematicRows = [
        {
          title: 'First <script> Article',
          url: 'https://example.com/1?param=<test>&other=value',
          time_added: '1507018057',
          tags: 'test,<tag>',
          status: 'unread'
        },
        {
          title: 'Second "quoted" Article',
          url: 'https://example.com/2?param="value"&other=test',
          time_added: '1507018058',
          tags: 'test,"quote"',
          status: 'read'
        }
      ];
      
      const notes = problematicRows.map(row => createNote(row));
      const enexData = createEnexStructure(notes);
      
      expect(enexData['en-export'].note).toHaveLength(2);
      
      // すべてのタイトルが適切にエスケープされていることを確認
      notes.forEach((note, index) => {
        expect(note.title).not.toContain('<script>');
        expect(note.title).not.toContain('"value"');
        
        // 各ノートで異なるエスケープパターンをチェック
        if (index === 0) {
          // 最初のノートは <script> を含む
          expect(note.content).toContain('&lt;script&gt;');
        } else {
          // 2番目のノートは引用符を含む
          expect(note.content).toContain('&quot;');
        }
        
        // 両方のノートで&amp;エスケープを確認
        expect(note.content).toContain('&amp;');
      });
    });
  });

  describe('XML Structure Validation', () => {
    test('should create valid XML structure that can be processed', () => {
      const testRows = [
        {
          title: 'Complex Title with "Quotes" & <Tags>',
          url: 'https://example.com/complex?param=value&other=data',
          time_added: '1507018057',
          tags: 'complex,xml,test',
          status: 'unread'
        }
      ];
      
      const notes = testRows.map(row => createNote(row));
      const enexData = createEnexStructure(notes);
      
      // ENEX構造の基本検証
      expect(enexData['en-export']).toBeDefined();
      expect(enexData['en-export'].$).toBeDefined();
      expect(enexData['en-export'].$.application).toBe('Evernote');
      expect(enexData['en-export'].$.version).toBe('10.0');
      expect(enexData['en-export'].$['export-date']).toMatch(/^\d{8}T\d{6}Z$/);
      
      // ノート構造の検証
      const note = enexData['en-export'].note[0];
      expect(note.title).toBeDefined();
      expect(note.content).toBeDefined();
      expect(note.created).toMatch(/^\d{8}T\d{6}Z$/);
      expect(note.updated).toMatch(/^\d{8}T\d{6}Z$/);
      expect(note['note-attributes']).toBeDefined();
      expect(note['note-attributes'][0]['source-url']).toBeDefined();
    });

    test('should handle multiple notes with consistent structure', () => {
      const multipleRows = Array.from({ length: 50 }, (_, i) => ({
        title: `Article ${i + 1}`,
        url: `https://example.com/article/${i + 1}`,
        time_added: (1507018057 + i).toString(),
        tags: `tag${i},category${i % 5}`,
        status: i % 2 === 0 ? 'unread' : 'read'
      }));
      
      const notes = multipleRows.map(row => createNote(row));
      const enexData = createEnexStructure(notes);
      
      expect(enexData['en-export'].note).toHaveLength(50);
      
      // すべてのノートが一貫した構造を持つことを確認
      enexData['en-export'].note.forEach((note, index) => {
        expect(note.title).toBe(`Article ${index + 1}`);
        expect(note['note-attributes'][0]['source-url']).toBe(`https://example.com/article/${index + 1}`);
        expect(note.created).toMatch(/^\d{8}T\d{6}Z$/);
        expect(note.tag).toContain(`tag${index}`);
      });
    });
  });

  describe('Data Integrity Tests', () => {
    test('should preserve all data fields correctly', () => {
      const completeRow = {
        title: 'Complete Test Article',
        url: 'https://example.com/complete',
        time_added: '1507018057',
        tags: 'complete,test,data,integrity',
        status: 'archived'
      };
      
      const note = createNote(completeRow);
      
      // すべてのフィールドが適切に保存されることを確認
      expect(note.title).toBe('Complete Test Article');
      expect(note['note-attributes'][0]['source-url']).toBe('https://example.com/complete');
      expect(note.tag).toEqual(['complete', 'test', 'data', 'integrity']);
      expect(note.content).toContain('Complete Test Article');
      expect(note.content).toContain('https://example.com/complete');
      expect(note.content).toContain('archived');
    });

    test('should handle edge case data values', () => {
      const edgeCaseRow = {
        title: '',  // 空のタイトル
        url: 'https://example.com/edge-case',
        time_added: '0',  // 最小タイムスタンプ
        tags: '',   // 空のタグ
        status: ''  // 空のステータス
      };
      
      const note = createNote(edgeCaseRow);
      
      // エッジケースでも適切に処理されることを確認
      expect(note.title).toBe('https://example.com/edge-case'); // URLがタイトルとして使用
      expect(note.tag).toBeUndefined(); // 空のタグは除外
      expect(note.created).toMatch(/^\d{8}T\d{6}Z$/); // 有効な日付形式
    });
  });
});