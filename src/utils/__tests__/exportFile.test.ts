export {};

const mockRNFS = {
  TemporaryDirectoryPath: '/tmp/ios',
  CachesDirectoryPath: '/tmp/android',
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
};
const mockShare = {
  share: jest.fn(),
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissedAction',
};
const mockSaveDocuments = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Share: mockShare,
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: mockRNFS,
}));

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: (error: unknown) =>
    !!error && typeof error === 'object' && 'code' in error,
  saveDocuments: mockSaveDocuments,
}));

const { Platform } = require('react-native');
const { exportFile } = require('../exportFile');

describe('file export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'android';
  });

  test('saves a real JSON document on Android', async () => {
    mockSaveDocuments.mockResolvedValue([{
      uri: 'content://downloads/backup.json',
      name: 'RutaWater_Backup.json',
      error: null,
    }]);

    await expect(exportFile(
      '{"schemaVersion":3}',
      'RutaWater_Backup.json',
      'application/json',
    )).resolves.toBe('saved');

    expect(mockSaveDocuments).toHaveBeenCalledWith({
      sourceUris: ['file:///tmp/android/RutaWater_Backup.json'],
      mimeType: 'application/json',
      fileName: 'RutaWater_Backup.json',
    });
    expect(mockShare.share).not.toHaveBeenCalled();
    expect(mockRNFS.unlink).toHaveBeenCalledWith('/tmp/android/RutaWater_Backup.json');
  });

  test('treats Android picker cancellation as cancellation, not success', async () => {
    mockSaveDocuments.mockRejectedValue(
      Object.assign(new Error('cancelled'), { code: 'OPERATION_CANCELED' }),
    );

    await expect(exportFile(
      '{}',
      'RutaWater_Backup.json',
      'application/json',
    )).resolves.toBe('cancelled');
    expect(mockRNFS.unlink).toHaveBeenCalledWith('/tmp/android/RutaWater_Backup.json');
  });

  test('rejects an empty Android save result and still removes the cache file', async () => {
    mockSaveDocuments.mockResolvedValue([]);

    await expect(exportFile(
      '{}',
      'RutaWater_Backup.json',
      'application/json',
    )).rejects.toThrow('EXPORT_SAVE_FAILED');
    expect(mockRNFS.unlink).toHaveBeenCalledWith('/tmp/android/RutaWater_Backup.json');
  });

  test('preserves iOS sharing and detects dismissal', async () => {
    (Platform as any).OS = 'ios';
    mockShare.share.mockResolvedValue({ action: 'dismissedAction' });

    await expect(exportFile(
      '{}',
      'RutaWater_Backup.json',
      'application/json',
    )).resolves.toBe('cancelled');
    expect(mockSaveDocuments).not.toHaveBeenCalled();
    expect(mockShare.share).toHaveBeenCalledWith({
      url: '/tmp/ios/RutaWater_Backup.json',
    });
  });
});
