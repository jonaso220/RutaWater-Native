import { existsSync, readFileSync } from 'fs';
import { acrobatLinkIn, readAcrobatLink } from '../src/acrobatLink';

const LINK = 'https://acrobat.adobe.com/id/urn:aaid:sc:VA6C2:11111111-2222-3333-4444-555555555555';
const RENDITION = 'https://cdn-sharing.adobecc.com/rendition/id/urn:aaid:sc:VA6C2:1;page=0;size=1200;type=image%2Fjpeg?access_token=t';
const DOWNLOAD = 'https://blobstore-data.adobe.io/abc?response-content-disposition=attachment%3B%20filename%3D%22Comprobante%2520(2).pdf%22&X-Amz-Signature=s';

const pageWith = (urls: unknown) => `<html><script id="dc_data" type="application/json">${JSON.stringify({ data: { file: { assetURLs: urls } } })}</script></html>`;

/** Internet de mentira: la página, dos vistas como imagen (la tercera no existe) y el PDF. */
const web = (html: string, pages = 1) => jest.fn(async (url: string) => {
  if (url === LINK) return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  const page = Number(url.match(/;page=(\d+)/)?.[1] ?? -1);
  if (url.startsWith('https://cdn-sharing.adobecc.com/')) {
    return page < pages
      ? new Response(`jpg${page}-${url.match(/;size=(\d+)/)?.[1]}`, { status: 200, headers: { 'content-type': 'image/jpeg' } })
      : new Response(null, { status: 404 });
  }
  if (url === DOWNLOAD) return new Response('%PDF-1.4 comprobante', { status: 200, headers: { 'content-type': 'application/pdf' } });
  throw new Error(`pedido inesperado: ${url}`);
}) as unknown as typeof fetch;

describe('link de Adobe Acrobat', () => {
  test('encuentra el link en el mensaje del cliente y descarta lo que no es de Acrobat', () => {
    expect(acrobatLinkIn(`Abre el documento compartido: ${LINK}\n\nDescarga la aplicación: https://adobeacrobat.app.link/x`)).toBe(LINK);
    expect(acrobatLinkIn(LINK.replace('https:', 'http:'))).toBe(LINK);
    expect(acrobatLinkIn('https://acrobat.adobe.com.estafa.com/id/urn:1')).toBeNull();
    expect(acrobatLinkIn('https://usuario@acrobat.adobe.com/id/urn:1')).toBeNull();
    expect(acrobatLinkIn('https://adobeacrobat.app.link/2oMAyrxR27b')).toBeNull();
    expect(acrobatLinkIn('hola, te mando el pago')).toBeNull();
  });

  test('devuelve la página como imagen grande y guarda el PDF con su nombre', async () => {
    const fetcher = web(pageWith({ url: RENDITION, download_url: DOWNLOAD }));
    const seen = await readAcrobatLink(`Abre el documento compartido: ${LINK}`, fetcher);
    expect(seen).toMatchObject({ link: LINK, nombre: 'Comprobante (2).pdf', paginas_vistas: 1 });
    expect(seen.images.map((image) => [image.data.toString(), image.mime])).toEqual([['jpg0-2000', 'image/jpeg']]);
    expect(seen.archivo && existsSync(seen.archivo) && readFileSync(seen.archivo, 'utf8')).toBe('%PDF-1.4 comprobante');
    expect(seen.archivo).toMatch(/Comprobante \(2\)\.pdf$/);
  });

  test('con varias páginas muestra hasta tres', async () => {
    const seen = await readAcrobatLink(LINK, web(pageWith({ url: RENDITION, download_url: DOWNLOAD }), 5));
    expect(seen.images.map((image) => image.data.toString())).toEqual(['jpg0-2000', 'jpg1-2000', 'jpg2-2000']);
    expect(seen.aviso).toContain('primeras 3 páginas');
  });

  test('no sigue direcciones que no son de Adobe', async () => {
    const fetcher = web(pageWith({ url: 'https://ejemplo.com/rendition;page=0', download_url: 'http://blobstore-data.adobe.io/abc' }));
    await expect(readAcrobatLink(LINK, fetcher)).rejects.toThrow('no muestra el documento');
    expect((fetcher as unknown as jest.Mock).mock.calls.map(([url]) => url)).toEqual([LINK]);
  });

  test('un link vencido, roto o que no es de Acrobat se dice sin romper', async () => {
    await expect(readAcrobatLink(LINK, web('<html>Inicia sesión</html>'))).rejects.toThrow('vencido');
    const broken = jest.fn(async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    await expect(readAcrobatLink(LINK, broken)).rejects.toThrow('No se pudo abrir');
    await expect(readAcrobatLink('https://ejemplo.com/doc.pdf')).rejects.toThrow('No es un link de Adobe Acrobat');
  });
});
