// テスト用モック（requireより前に設定）
jest.mock('fs');
jest.mock('puppeteer', () => ({
  launch: jest.fn()
}));

const fs = require('fs');

const { CheckpointManager } = require('../index.js');

describe('CheckpointManager Tests', () => {
  let checkpointManager;
  const mockOutputPath = '/test/output.enex';
  const mockOptions = {
    checkpointInterval: 2,
    batchSize: 3
  };

  beforeEach(() => {
    jest.clearAllMocks();
    checkpointManager = new CheckpointManager(mockOutputPath, mockOptions);
  });

  describe('Initialization', () => {
    test('should initialize with correct paths and options', () => {
      expect(checkpointManager.outputPath).toBe(mockOutputPath);
      expect(checkpointManager.checkpointPath).toBe('/test/output.checkpoint.json');
      expect(checkpointManager.interval).toBe(2);
      expect(checkpointManager.batchSize).toBe(3);
    });

    test('should initialize with default options', () => {
      const manager = new CheckpointManager('/test/output.enex');
      expect(manager.interval).toBe(100);
      expect(manager.batchSize).toBe(10);
    });

    test('should initialize progress object correctly', () => {
      expect(checkpointManager.progress.processedCount).toBe(0);
      expect(checkpointManager.progress.totalCount).toBe(0);
      expect(checkpointManager.progress.lastProcessedIndex).toBe(-1);
      expect(checkpointManager.progress.failedUrls).toEqual([]);
      expect(checkpointManager.progress.processedNotes).toEqual([]);
      expect(typeof checkpointManager.progress.timestamp).toBe('number');
      expect(typeof checkpointManager.progress.startTime).toBe('number');
    });
  });

  describe('Checkpoint Detection', () => {
    test('should detect existing checkpoint file', () => {
      fs.existsSync.mockReturnValue(true);
      expect(checkpointManager.hasCheckpoint()).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/test/output.checkpoint.json');
    });

    test('should detect non-existing checkpoint file', () => {
      fs.existsSync.mockReturnValue(false);
      expect(checkpointManager.hasCheckpoint()).toBe(false);
    });
  });

  describe('Loading Checkpoints', () => {
    test('should load valid checkpoint data', () => {
      const mockProgress = {
        processedCount: 150,
        totalCount: 1000,
        lastProcessedIndex: 149,
        failedUrls: ['http://failed.com'],
        processedNotes: [{ title: 'Test Note' }],
        timestamp: Date.now(),
        startTime: Date.now()
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockProgress));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = checkpointManager.loadCheckpoint();

      expect(result).toEqual(mockProgress);
      expect(checkpointManager.progress).toEqual(mockProgress);
      expect(consoleSpy).toHaveBeenCalledWith('\nResuming from checkpoint:');
      expect(consoleSpy).toHaveBeenCalledWith('  Processed: 150/1000');

      consoleSpy.mockRestore();
    });

    test('should return null when no checkpoint exists', () => {
      fs.existsSync.mockReturnValue(false);
      const result = checkpointManager.loadCheckpoint();
      expect(result).toBeNull();
    });

    test('should handle corrupted checkpoint file', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = checkpointManager.loadCheckpoint();

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load checkpoint:', expect.any(String));

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Saving Checkpoints', () => {
    test('should save checkpoint data correctly', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      fs.writeFileSync.mockImplementation(() => {});

      checkpointManager.progress.processedCount = 50;
      checkpointManager.progress.totalCount = 100;

      checkpointManager.saveCheckpoint();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/output.checkpoint.json',
        expect.stringContaining('"processedCount": 50')
      );
      // コンソール出力は削除されたので確認しない

      consoleSpy.mockRestore();
    });

    test('should handle save errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      checkpointManager.saveCheckpoint();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to save checkpoint:', 'Write failed');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Progress Updates', () => {
    test('should update progress correctly', () => {
      const mockNote = { title: 'Test Note', content: 'Test Content' };
      const mockFailedUrl = 'http://failed.com';

      checkpointManager.updateProgress(5, 100, 4, mockNote, mockFailedUrl);

      expect(checkpointManager.progress.processedCount).toBe(5);
      expect(checkpointManager.progress.totalCount).toBe(100);
      expect(checkpointManager.progress.lastProcessedIndex).toBe(4);
      expect(checkpointManager.progress.processedNotes).toContain(mockNote);
      expect(checkpointManager.progress.failedUrls).toContain(mockFailedUrl);
    });

    test('should trigger checkpoint save at interval', () => {
      const saveCheckpointSpy = jest.spyOn(checkpointManager, 'saveCheckpoint').mockImplementation();
      const saveIntermediateSpy = jest.spyOn(checkpointManager, 'saveIntermediateEnex').mockImplementation();

      // Interval is 2, so it should save at processedCount = 2
      checkpointManager.updateProgress(2, 100, 1);

      expect(saveCheckpointSpy).toHaveBeenCalled();
      expect(saveIntermediateSpy).toHaveBeenCalled();

      saveCheckpointSpy.mockRestore();
      saveIntermediateSpy.mockRestore();
    });

    test('should not trigger checkpoint save between intervals', () => {
      const saveCheckpointSpy = jest.spyOn(checkpointManager, 'saveCheckpoint').mockImplementation();

      // Interval is 2, so it should not save at processedCount = 1
      checkpointManager.updateProgress(1, 100, 0);

      expect(saveCheckpointSpy).not.toHaveBeenCalled();

      saveCheckpointSpy.mockRestore();
    });
  });

  describe('Cleanup', () => {
    test('should remove checkpoint file when it exists', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {});

      checkpointManager.cleanup();

      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/output.checkpoint.json');
      // コンソール出力は削除されたので確認しない

      consoleSpy.mockRestore();
    });

    test('should not attempt to remove non-existing checkpoint file', () => {
      fs.existsSync.mockReturnValue(false);
      fs.unlinkSync.mockImplementation(() => {});

      checkpointManager.cleanup();

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    test('should handle cleanup errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      checkpointManager.cleanup();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to cleanup checkpoint:', 'Delete failed');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Statistics', () => {
    test('should show processing statistics correctly', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Set up test data
      checkpointManager.progress.processedCount = 80;
      checkpointManager.progress.totalCount = 100;
      checkpointManager.progress.failedUrls = ['http://fail1.com', 'http://fail2.com'];
      checkpointManager.progress.startTime = Date.now() - 60000; // 1 minute ago

      checkpointManager.showStats();

      expect(consoleSpy).toHaveBeenCalledWith('\nProcessing Statistics:');
      expect(consoleSpy).toHaveBeenCalledWith('  Total processed: 80/100');
      expect(consoleSpy).toHaveBeenCalledWith('  Success rate: 97.5%'); // (80-2)/80 * 100
      expect(consoleSpy).toHaveBeenCalledWith('  Failed URLs: 2');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Processing rate: \d+\.\d+ items\/sec/));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Elapsed time: \d+\.\d+ minutes/));

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty progress data', () => {
      checkpointManager.progress.processedCount = 0;
      checkpointManager.progress.totalCount = 0;
      checkpointManager.progress.failedUrls = [];

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      checkpointManager.showStats();

      expect(consoleSpy).toHaveBeenCalledWith('  Total processed: 0/0');
      expect(consoleSpy).toHaveBeenCalledWith('  Failed URLs: 0');

      consoleSpy.mockRestore();
    });

    test('should handle updateProgress with null values', () => {
      checkpointManager.updateProgress(1, 10, 0, null, null);

      expect(checkpointManager.progress.processedCount).toBe(1);
      expect(checkpointManager.progress.totalCount).toBe(10);
      expect(checkpointManager.progress.lastProcessedIndex).toBe(0);
      expect(checkpointManager.progress.processedNotes).toHaveLength(0);
      expect(checkpointManager.progress.failedUrls).toHaveLength(0);
    });
  });
});