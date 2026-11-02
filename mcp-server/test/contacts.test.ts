import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contactName, saveContact, uyPhone } from '../src/contacts';

describe('contactos', () => {
  test('teléfono uruguayo en formato internacional', () => {
    expect(uyPhone('099 309 717')).toBe('+59899309717');
    expect(uyPhone('+598 91 667 066')).toBe('+59891667066');
    expect(uyPhone('91667066')).toBe('+59891667066');
    expect(() => uyPhone('123')).toThrow('inválido');
  });
  test('nombre del contacto: nombre - dirección - y el link aparte', () => {
    expect(contactName('Irma', 'Sarandí esq. Baltasar Brum', 'https://maps.app.goo.gl/x')).toEqual({ first: 'Irma - Sarandí esq. Baltasar Brum -', last: 'https://maps.app.goo.gl/x' });
    expect(contactName('Irma', '', '')).toEqual({ first: 'Irma', last: '' });
  });

  describe('guardar por la app', () => {
    const input = { nombre: 'Irma', direccion: 'Sarandí', telefono: '099309717' };
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'contactos-'));
      process.env.RUTAWATER_CONTACTOS_DIR = dir;
    });
    afterEach(() => {
      delete process.env.RUTAWATER_CONTACTOS_DIR;
      rmSync(dir, { recursive: true, force: true });
    });

    test('le pasa el pedido y devuelve lo que hizo', async () => {
      const result = await saveContact(input, async () => {
        expect(JSON.parse(readFileSync(join(dir, 'pedido.json'), 'utf8'))).toEqual({ first: 'Irma - Sarandí', last: '', phone: '+59899309717' });
        writeFileSync(join(dir, 'resultado.json'), JSON.stringify({ actualizados: 1, creado: false }));
      });
      expect(result).toEqual({ contacto: 'Irma - Sarandí', telefono: '+59899309717', actualizados: 1, creado: false });
      expect(existsSync(join(dir, 'ocupado'))).toBe(false);
    });

    test('sin permiso avisa y libera el turno', async () => {
      await expect(saveContact(input, async () => {
        writeFileSync(join(dir, 'resultado.json'), JSON.stringify({ error: 'Not authorized', numero: -1743 }));
      })).rejects.toThrow('Not authorized (-1743)');
      expect(existsSync(join(dir, 'ocupado'))).toBe(false);
    });

    test('un resultado viejo no cuenta como hecho', async () => {
      writeFileSync(join(dir, 'resultado.json'), JSON.stringify({ actualizados: 1, creado: false }));
      await expect(saveContact(input, async () => {})).rejects.toThrow('no dejó resultado');
    });

    test('dos a la vez van de a uno', async () => {
      let running = 0;
      const open = async () => {
        running += 1;
        expect(running).toBe(1);
        await new Promise((done) => setTimeout(done, 50));
        writeFileSync(join(dir, 'resultado.json'), JSON.stringify({ actualizados: 0, creado: true }));
        running -= 1;
      };
      await Promise.all([saveContact(input, open), saveContact(input, open)]);
    });
  });
});
