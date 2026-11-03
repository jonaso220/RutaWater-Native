import { describeMapsLink, placeFromMapsUrl, readMapsLink } from '../src/mapsLink';

// Redirección como la de maps.app.goo.gl: un salto y después la página sin más saltos.
const redirectTo = (target: string) => jest.fn(async (url: string) => (url === target
  ? new Response(null, { status: 200 })
  : new Response(null, { status: 302, headers: { location: target } }))) as unknown as typeof fetch;

describe('link de Google Maps', () => {
  test('saca el texto del lugar sin código postal, departamento ni plus code', () => {
    expect(placeFromMapsUrl('https://maps.google.com/maps?q=Ituzaing%C3%B3+3719,+15400+San+Luis,+Departamento+de+Canelones&ftid=0x1:0x2')).toBe('Ituzaingó 3719, San Luis');
    expect(placeFromMapsUrl('https://www.google.com/maps/place/Plut%C3%B3n+641,+15800+Ciudad+de+la+Costa,+Departamento+de+Canelones/data=!4m2')).toBe('Plutón 641, Ciudad de la Costa');
    expect(placeFromMapsUrl('https://maps.google.com/maps?q=53WR%2BGJF+Super+Pinar,+Av.+Perez+Butler,+15800+Ciudad+de+la+Costa')).toBe('Super Pinar, Av. Perez Butler, Ciudad de la Costa');
    expect(placeFromMapsUrl('https://maps.google.com/?q=-34.77,-55.83')).toBe('');
    expect(placeFromMapsUrl("https://www.google.com/maps/place/34%C2%B047'59.1%22S+55%C2%B054'53.6%22W/@-34.79,-55.91,17z")).toBe('');
  });

  test('con punto en el destino da las coordenadas', async () => {
    const read = await readMapsLink('https://maps.app.goo.gl/abc', redirectTo('https://www.google.com/maps/place/Casa/@-34.77,-55.83,17z'));
    expect(read).toEqual({ point: { lat: -34.77, lng: -55.83 }, place: 'Casa' });
  });

  test('sin punto trae el texto y lo avisa, sin inventar coordenadas', async () => {
    const seen = await describeMapsLink('https://maps.app.goo.gl/abc', redirectTo('https://maps.google.com/maps?q=C.+10+5247,+15100+Pinamar,+Departamento+de+Canelones&ftid=0x1:0x2'));
    expect(seen).toMatchObject({ coordenadas: null, lugar: 'C. 10 5247, Pinamar', direccion_del_mapa: null });
    expect(seen.aviso).toContain('punto marcado');
  });

  test('un link roto no rompe la lectura, y lo que no es de Maps se rechaza', async () => {
    const broken = jest.fn(async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    expect(await readMapsLink('https://maps.app.goo.gl/abc', broken)).toEqual({ point: null, place: '' });
    await expect(describeMapsLink('https://ejemplo.com/mapa')).rejects.toThrow('No es un link');
  });
});
