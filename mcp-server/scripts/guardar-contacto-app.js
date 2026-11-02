// «RutaWater Contactos.app»: lo único que tiene el permiso de Contactos (2/11/2026).
// El permiso no puede estar en node: cada actualización de Homebrew le cambia la firma
// y macOS lo toma como otro programa. Esta app no cambia nunca: lo que hace está en
// ~/.rutawater-mcp/guardar-contacto/guardar.js (guardar-contacto.js del repo).
ObjC.import('Foundation');

function run() {
  const base = `${$.NSHomeDirectory().js}/.rutawater-mcp/guardar-contacto/`;
  const read = (name) => $.NSString.stringWithContentsOfFileEncodingError(base + name, $.NSUTF8StringEncoding, null).js;
  let outcome;
  try {
    outcome = eval(read('guardar.js'))(JSON.parse(read('pedido.json')));
  } catch (error) {
    outcome = { error: String(error.message || error), numero: error.errorNumber };
  }
  $(JSON.stringify(outcome)).writeToFileAtomicallyEncodingError(`${base}resultado.json`, true, $.NSUTF8StringEncoding, null);
}
