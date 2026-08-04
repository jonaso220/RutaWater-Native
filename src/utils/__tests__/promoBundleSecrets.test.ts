import fs from 'fs';
import path from 'path';

const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : walk(fullPath);
    }
    return /\.(ts|tsx|js|jsx|rules)$/.test(entry.name) ? [fullPath] : [];
  });

describe('promo secrets in the mobile bundle', () => {
  test('does not ship retired codes or a local promo registry', () => {
    const productionFiles = [
      ...walk(path.resolve(process.cwd(), 'src')),
      ...walk(path.resolve(process.cwd(), 'netlify/functions')),
      path.resolve(process.cwd(), 'firestore.rules'),
    ];
    const source = productionFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    const retiredCodes = [
      'RUTA' + 'FAMILIA',
      'RUTA' + 'AMIGOS',
      'RUTA' + 'VIP2026',
    ];

    retiredCodes.forEach((code) => expect(source).not.toContain(code));
    expect(source).not.toContain('PROMO_' + 'CODES');
  });
});
