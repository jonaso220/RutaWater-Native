import { ImageSourcePropType } from 'react-native';

// Bundled "sticker" icons (flat app-icon style PNGs at @1x/@2x/@3x in this
// folder). Picked in the product catalog and stored on the product as
// `sticker:<id>` in the same `emoji` field (see ProductIcon / isSticker).
// To add one: drop name.png + name@2x.png + name@3x.png here and add a line.
export const STICKERS: Record<string, ImageSourcePropType> = {
  // Fotos reales de productos (provistas por el usuario, fondo transparente).
  bidon_foto: require('./bidon_foto.png'),
  bidon_6l: require('./bidon_6l.png'),
  disp_electrico: require('./disp_electrico.png'),
  bombita: require('./bombita.png'),
  disp: require('./disp.png'),
  sifon: require('./sifon.png'),
  guarana: require('./guarana.png'),
  lima: require('./lima.png'),
  naranja: require('./naranja.png'),
  pomelo: require('./pomelo.png'),
  uva: require('./uva.png'),
  // Ilustraciones generadas (estilo ícono-app).
  bidon: require('./bidon.png'),
  bidon_mini: require('./bidon_mini.png'),
  dispenser: require('./dispenser.png'),
  bottle: require('./bottle.png'),
  droplet: require('./droplet.png'),
  drop_plus: require('./drop_plus.png'),
  ice: require('./ice.png'),
  soda: require('./soda.png'),
  juice: require('./juice.png'),
  truck: require('./truck.png'),
  box: require('./box.png'),
  cart: require('./cart.png'),
  leaf: require('./leaf.png'),
  home: require('./home.png'),
  star: require('./star.png'),
};

// Display order in the picker.
export const STICKER_IDS = Object.keys(STICKERS);
