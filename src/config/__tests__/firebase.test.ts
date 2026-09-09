export {};

const mockSettings = jest.fn();
const mockDb = { settings: mockSettings };
const mockFirestore = Object.assign(jest.fn(() => mockDb), { CACHE_SIZE_UNLIMITED: -1 });
const mockAuth = {};
jest.mock('@react-native-firebase/firestore', () => ({ __esModule: true, default: mockFirestore }));
jest.mock('@react-native-firebase/auth', () => ({ __esModule: true, default: () => mockAuth }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
const { Platform } = require('react-native');

test('Android exposes Firestore without racing native startup with asynchronous settings', () => {
  Platform.OS = 'android';
  mockSettings.mockClear();
  jest.isolateModules(() => {
    const { db, fbAuth } = require('../firebase');
    expect(db).toBe(mockDb);
    expect(fbAuth).toBe(mockAuth);
    expect(mockSettings).not.toHaveBeenCalled();
  });
});

test('iOS retains its existing unlimited persistent cache configuration', () => {
  Platform.OS = 'ios';
  mockSettings.mockClear();
  jest.isolateModules(() => {
    require('../firebase');
    expect(mockSettings).toHaveBeenCalledWith({ persistence: true, cacheSizeBytes: -1 });
  });
});
