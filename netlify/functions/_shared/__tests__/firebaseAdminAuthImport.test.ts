describe('Firebase Admin Auth runtime dependency', () => {
  test('loads through CommonJS in the Netlify-compatible dependency line', () => {
    expect(() => {
      const { getAuth } = require('firebase-admin/auth') as typeof import('firebase-admin/auth');
      expect(typeof getAuth).toBe('function');
    }).not.toThrow();
  });
});
