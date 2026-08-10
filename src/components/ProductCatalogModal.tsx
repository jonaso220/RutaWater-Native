import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';
import {
  useAllProducts,
  useProductCatalogStore,
} from '../stores/productCatalogStore';
import ProductIcon, { STICKER_PREFIX } from './ProductIcon';
import { STICKER_IDS } from '../assets/stickers';
import { useClientsStore } from '../stores/clientsStore';
import { countProductReferences } from '../utils/productCounter';

interface ProductCatalogModalProps {
  visible: boolean;
  onClose: () => void;
}

// Icons grouped by category. The grid is a quick pick; users can also type
// ANY emoji from their keyboard in the picker's free field below the grid.
const EMOJI_CATEGORIES: { key: string; emojis: string[] }[] = [
  { key: 'water', emojis: ['💧', '🚰', '🫧', '💦', '🪣', '🧊', '❄️', '🌊', '🚿', '🛁', '🌧️', '☔', '💎', '🏔️'] },
  { key: 'drinks', emojis: ['🥤', '🧃', '🍶', '🥛', '🧉', '☕', '🧋', '🍷', '🍺', '🍻', '🍹', '🍸', '🥃', '🥂', '🍾', '🍵', '🫗'] },
  { key: 'food', emojis: ['🍞', '🥖', '🥐', '🧀', '🍎', '🍌', '🍊', '🍓', '🍇', '🥑', '🥕', '🌽', '🥚', '🍫', '🍪', '🍬', '🍭', '🥜', '🍯', '🧂', '🍕', '🍔'] },
  { key: 'containers', emojis: ['📦', '🫙', '🛢️', '🥫', '🧴', '🧼', '🧯', '🪥', '🧰', '🧺', '🗑️', '🏺', '📥'] },
  { key: 'energy', emojis: ['🔌', '⚡', '🔋', '🔥', '⛽', '🪫', '💡', '🔦', '🕯️', '☀️', '🌡️', '🔆', '🛠️', '⚙️', '🔧'] },
  { key: 'transport', emojis: ['🚚', '🚛', '🛻', '🚐', '🚗', '🚙', '🏍️', '🛵', '🚲', '🛴', '📍', '🗺️', '🧭', '🚦', '🏁', '🛞'] },
  { key: 'money', emojis: ['💰', '💵', '💸', '🪙', '💳', '🧾', '📊', '📈', '📉', '🧮', '💲', '🤑', '🏧', '🛒', '🛍️', '🏷️'] },
  { key: 'places', emojis: ['🏠', '🏡', '🏢', '🏬', '🏭', '🏪', '🏫', '🏥', '🏦', '🏨', '🏚️', '⛪', '🏗️', '🚪', '🏘️'] },
  { key: 'nature', emojis: ['🌿', '🍃', '🌱', '🪴', '🌳', '🌲', '🌴', '🌵', '🌻', '🌷', '🌹', '🌾', '🍀', '🌼', '🐟', '🐝', '🦋', '🌍'] },
  { key: 'symbols', emojis: ['⭐', '🌟', '✨', '✅', '❌', '❤️', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🔶', '🔷', '🏆', '🥇', '🎁', '🔔', '📌', '✔️', '➕', '❗'] },
  { key: 'other', emojis: ['📋', '📝', '📅', '🗓️', '⏰', '🔑', '📞', '💬', '⚠️', '♻️', '🆕', '🔝', '📢', '🔢'] },
];

// Search keywords (Spanish, lowercase) per emoji, so users can type "casa",
// "auto", "fuego"... and filter the grid by name. Accent-insensitive at runtime.
const EMOJI_KEYWORDS: Record<string, string> = {
  // water
  '💧': 'gota agua water drop', '🚰': 'agua potable grifo canilla tap', '🫧': 'burbujas bubbles',
  '💦': 'gotas agua sudor splash', '🪣': 'balde cubo bucket', '🧊': 'hielo cubo ice',
  '❄️': 'nieve copo frio snow cold', '🌊': 'ola mar agua wave ocean', '🚿': 'ducha shower',
  '🛁': 'bañera baño bath', '🌧️': 'lluvia rain', '☔': 'paraguas lluvia umbrella',
  '💎': 'diamante gema diamond', '🏔️': 'montaña nieve mountain',
  // drinks
  '🥤': 'vaso gaseosa bebida soda', '🧃': 'jugo caja juice', '🍶': 'sake botella sifon',
  '🥛': 'leche vaso milk', '🧉': 'mate', '☕': 'cafe te coffee', '🧋': 'bubble tea tapioca',
  '🍷': 'vino copa wine', '🍺': 'cerveza birra beer', '🍻': 'cervezas brindis beers',
  '🍹': 'trago coctel cocktail', '🍸': 'trago martini coctel', '🥃': 'whisky vaso',
  '🥂': 'brindis copas champagne', '🍾': 'champagne botella', '🍵': 'te matcha tea',
  '🫗': 'verter servir pour',
  // food
  '🍞': 'pan bread', '🥖': 'pan baguette', '🥐': 'medialuna croissant factura',
  '🧀': 'queso cheese', '🍎': 'manzana fruta apple', '🍌': 'banana platano fruta',
  '🍊': 'naranja mandarina fruta orange', '🍓': 'frutilla fresa strawberry', '🍇': 'uva uvas grape',
  '🥑': 'palta aguacate avocado', '🥕': 'zanahoria verdura carrot', '🌽': 'choclo maiz corn',
  '🥚': 'huevo egg', '🍫': 'chocolate', '🍪': 'galleta cookie', '🍬': 'caramelo dulce candy',
  '🍭': 'chupetin paleta lollipop', '🥜': 'mani cacahuate nuts', '🍯': 'miel honey',
  '🧂': 'sal salt', '🍕': 'pizza', '🍔': 'hamburguesa burger',
  // containers
  '📦': 'caja paquete box package', '🫙': 'frasco tarro jar', '🛢️': 'tambor barril bidon tanque',
  '🥫': 'lata conserva can', '🧴': 'botella envase locion bombita', '🧼': 'jabon soap',
  '🧯': 'matafuego extintor', '🪥': 'cepillo dientes', '🧰': 'caja herramientas toolbox',
  '🧺': 'canasta cesto basket', '🗑️': 'basura tacho trash', '🏺': 'anfora vasija jarron',
  '📥': 'bandeja entrada recibir inbox',
  // energy
  '🔌': 'enchufe electricidad plug', '⚡': 'rayo energia electricidad', '🔋': 'bateria pila battery',
  '🔥': 'fuego llama fire', '⛽': 'nafta combustible gasolina fuel', '🪫': 'bateria baja',
  '💡': 'lampara luz idea bulb', '🔦': 'linterna flashlight', '🕯️': 'vela candle',
  '☀️': 'sol sun', '🌡️': 'termometro temperatura', '🔆': 'brillo luz',
  '🛠️': 'herramientas tools', '⚙️': 'engranaje config gear', '🔧': 'llave herramienta wrench',
  // transport
  '🚚': 'camion reparto entrega truck', '🚛': 'camion acoplado truck', '🛻': 'camioneta pickup',
  '🚐': 'combi van furgon', '🚗': 'auto coche car', '🚙': 'auto camioneta suv',
  '🏍️': 'moto motocicleta', '🛵': 'moto scooter', '🚲': 'bici bicicleta bike',
  '🛴': 'monopatin scooter', '📍': 'ubicacion pin lugar location', '🗺️': 'mapa map',
  '🧭': 'brujula compass', '🚦': 'semaforo trafico', '🏁': 'meta bandera finish',
  '🛞': 'rueda neumatico tire',
  // money
  '💰': 'plata dinero bolsa money', '💵': 'billete dolar plata cash', '💸': 'plata gasto volando',
  '🪙': 'moneda coin', '💳': 'tarjeta credito card', '🧾': 'recibo factura ticket',
  '📊': 'grafico barras chart', '📈': 'grafico suba aumento', '📉': 'grafico baja caida',
  '🧮': 'abaco calculo cuentas', '💲': 'signo peso dolar dinero', '🤑': 'plata cara rico',
  '🏧': 'cajero atm', '🛒': 'carrito compras cart', '🛍️': 'bolsas compras shopping',
  '🏷️': 'etiqueta precio tag',
  // places
  '🏠': 'casa home house', '🏡': 'casa jardin home', '🏢': 'edificio oficina building',
  '🏬': 'tienda centro comercial mall', '🏭': 'fabrica factory', '🏪': 'kiosco almacen tienda store',
  '🏫': 'escuela colegio school', '🏥': 'hospital', '🏦': 'banco bank', '🏨': 'hotel',
  '🏚️': 'casa abandonada ruina', '⛪': 'iglesia church', '🏗️': 'construccion obra',
  '🚪': 'puerta door', '🏘️': 'casas barrio houses',
  // nature
  '🌿': 'planta hierba hoja herb', '🍃': 'hojas hoja viento leaves', '🌱': 'brote planta sprout',
  '🪴': 'planta maceta', '🌳': 'arbol tree', '🌲': 'pino arbol pine', '🌴': 'palmera palm',
  '🌵': 'cactus', '🌻': 'girasol flor sunflower', '🌷': 'tulipan flor tulip',
  '🌹': 'rosa flor rose', '🌾': 'trigo espiga wheat', '🍀': 'trebol suerte clover',
  '🌼': 'flor margarita flower', '🐟': 'pez pescado fish', '🐝': 'abeja bee',
  '🦋': 'mariposa butterfly', '🌍': 'mundo tierra planeta earth',
  // symbols
  '⭐': 'estrella favorito star', '🌟': 'estrella brillo', '✨': 'brillos destellos sparkles',
  '✅': 'check tilde listo ok', '❌': 'cruz no error', '❤️': 'corazon amor heart',
  '🔴': 'rojo circulo red', '🟠': 'naranja circulo orange', '🟡': 'amarillo circulo yellow',
  '🟢': 'verde circulo green', '🔵': 'azul circulo blue', '🟣': 'violeta circulo purple',
  '⚫': 'negro circulo black', '⚪': 'blanco circulo white', '🔶': 'naranja rombo diamante',
  '🔷': 'azul rombo diamante', '🏆': 'trofeo premio trophy', '🥇': 'medalla oro primero gold',
  '🎁': 'regalo gift', '🔔': 'campana notificacion bell', '📌': 'chincheta pin tachuela',
  '✔️': 'tilde check', '➕': 'mas suma agregar plus', '❗': 'exclamacion importante',
  // other
  '📋': 'portapapeles lista clipboard', '📝': 'nota escribir lapiz note', '📅': 'calendario fecha',
  '🗓️': 'calendario agenda', '⏰': 'reloj alarma despertador clock', '🔑': 'llave clave key',
  '📞': 'telefono llamada phone', '💬': 'mensaje chat globo', '⚠️': 'advertencia peligro warning',
  '♻️': 'reciclar reciclaje recycle', '🆕': 'nuevo new', '🔝': 'arriba top',
  '📢': 'megafono anuncio altavoz', '🔢': 'numeros digitos numbers',
};

// Lowercase + strip accents so "energía"/"energia" and "limón"/"limon" both match.
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Strip the U+FE0F variation selector so keyword lookup never breaks on it.
const stripVS = (s: string) => s.replace(/\uFE0F/g, '');
const EMOJI_KEYWORDS_NORM: Record<string, string> = Object.fromEntries(
  Object.entries(EMOJI_KEYWORDS).map(([k, v]) => [stripVS(k), v]),
);
const ALL_EMOJIS: string[] = [...new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis))];

// Search keywords for the bundled stickers (same idea as EMOJI_KEYWORDS).
const STICKER_KEYWORDS: Record<string, string> = {
  bidon_foto: 'bidon botellon garrafa 20 litros agua foto',
  bidon_6l: 'bidon 6 litros agua botella pet retornable',
  disp_electrico: 'dispenser electrico frio calor surtidor agua rotel canilla',
  bombita: 'bombita bomba dispenser electrico agua usb cargable surtidor pico',
  disp: 'dispenser surtidor agua frio calor',
  sifon: 'sifon soda gaseosa retornable agua',
  guarana: 'guarana bebida gaseosa refresco verde limrl',
  lima: 'lima limon bebida gaseosa refresco verde limrl',
  naranja: 'naranja bebida gaseosa refresco jugo limrl',
  pomelo: 'pomelo pomelos bebida gaseosa refresco amarillo limrl',
  uva: 'uva uvas bebida gaseosa refresco violeta morado limrl',
  bidon: 'bidon agua 20 botellon garrafa',
  bidon_mini: 'bidon chico 12 6 agua botella',
  dispenser: 'dispenser surtidor frio calor agua',
  bottle: 'botella agua envase',
  droplet: 'gota agua',
  drop_plus: 'gota mas agua premium',
  ice: 'hielo frio copo nieve cubo',
  soda: 'sifon soda gaseosa vaso bebida',
  juice: 'jugo caja naranja bebida',
  truck: 'camion reparto entrega flete',
  box: 'caja paquete pack bulto',
  cart: 'carrito compras pedido',
  leaf: 'hoja natural verde planta',
  home: 'casa hogar domicilio',
  star: 'estrella favorito destacado',
};

// Everything pickable: stickers first, then emojis.
const ALL_PICKABLE: string[] = [
  ...STICKER_IDS.map((id) => STICKER_PREFIX + id),
  ...ALL_EMOJIS,
];
const keywordsFor = (item: string) =>
  item.startsWith(STICKER_PREFIX)
    ? STICKER_KEYWORDS[item.slice(STICKER_PREFIX.length)] || ''
    : EMOJI_KEYWORDS_NORM[stripVS(item)] || '';

const NEW_TARGET = '__new__';

const ProductCatalogModal: React.FC<ProductCatalogModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);
  // Pixel size for sticker images (scales with the app's font scale).
  const sz = (v: number) => Math.round(v * fontScale);

  const allProducts = useAllProducts();
  const hidden = useProductCatalogStore((s) => s.hidden);
  const customProducts = useProductCatalogStore((s) => s.customProducts);
  const renameProduct = useProductCatalogStore((s) => s.renameProduct);
  const setProductEmoji = useProductCatalogStore((s) => s.setProductEmoji);
  const setProductHidden = useProductCatalogStore((s) => s.setProductHidden);
  const addProduct = useProductCatalogStore((s) => s.addProduct);
  const removeCustomProduct = useProductCatalogStore((s) => s.removeCustomProduct);
  const moveProduct = useProductCatalogStore((s) => s.moveProduct);
  const clientsLoading = useClientsStore((s) => s.loading);

  const [newEmoji, setNewEmoji] = useState('');
  const [newName, setNewName] = useState('');
  const [newShort, setNewShort] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingActionsRef = useRef(0);
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Which product's emoji is being edited: a product id, NEW_TARGET, or null.
  const [emojiTarget, setEmojiTarget] = useState<string | null>(null);
  const [emojiDraft, setEmojiDraft] = useState('');
  const [emojiSearch, setEmojiSearch] = useState('');

  // null = not searching (show categories); array = flat search results
  // (stickers + emojis) matched by keyword.
  const emojiResults = useMemo(() => {
    const q = normalize(emojiSearch.trim());
    if (!q) return null;
    return ALL_PICKABLE.filter((item) => normalize(keywordsFor(item)).includes(q));
  }, [emojiSearch]);

  const closeEmojiPicker = (force = false) => {
    if (savingRef.current && !force) return;
    setEmojiTarget(null);
    setEmojiDraft('');
    setEmojiSearch('');
  };

  const isCustom = (id: string) => customProducts.some((c) => c.id === id);

  const runCatalogAction = async (
    action: () => Promise<void>,
    onSuccess?: () => void,
  ): Promise<boolean> => {
    pendingActionsRef.current += 1;
    savingRef.current = true;
    setSaving(true);
    const queued = actionQueueRef.current.then(async () => {
      try {
        await action();
        onSuccess?.();
        return true;
      } catch {
        Alert.alert(t('error'), t('settings.productsSaveError'));
        return false;
      }
    });
    actionQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued.finally(() => {
      pendingActionsRef.current -= 1;
      if (pendingActionsRef.current === 0) {
        savingRef.current = false;
        setSaving(false);
      }
    });
  };

  const requestClose = () => {
    if (!savingRef.current) onClose();
  };

  const pickEmoji = async (emoji: string) => {
    const value = emoji.trim();
    if (!value) return;
    if (emojiTarget === NEW_TARGET) {
      setNewEmoji(value);
      closeEmojiPicker();
    } else if (emojiTarget) {
      await runCatalogAction(
        () => setProductEmoji(emojiTarget, value),
        () => closeEmojiPicker(true),
      );
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await runCatalogAction(
      () => addProduct({ label: newName, emoji: newEmoji, short: newShort }),
      () => {
        setNewEmoji('');
        setNewName('');
        setNewShort('');
      },
    );
  };

  const handleDelete = (id: string, name: string) => {
    const canDeleteLatestProduct = (): boolean => {
      const { clients: latestClients, loading } = useClientsStore.getState();
      if (loading) {
        Alert.alert(t('settings.productUsageLoadingTitle'), t('settings.productUsageLoadingMsg'));
        return false;
      }
      const referenceCount = countProductReferences(latestClients, id);
      if (referenceCount <= 0) return true;
      Alert.alert(
        t('settings.productInUseTitle'),
        t('settings.productInUseMsg', { name, count: referenceCount }),
      );
      return false;
    };

    if (!canDeleteLatestProduct()) return;
    Alert.alert(t('settings.deleteProductTitle'), t('settings.deleteProductMsg', { name }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          if (canDeleteLatestProduct()) {
            void runCatalogAction(() => removeCustomProduct(id));
          }
        },
      },
    ]);
  };

  return (
    <ModalOverlay visible={visible} onClose={requestClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('settings.productsTitle')}</Text>
            <TouchableOpacity onPress={requestClose} style={styles.closeBtn} disabled={saving}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.subtitle}>{t('settings.productsSubtitle')}</Text>

            {allProducts.map((p, index) => {
              const isHidden = hidden.includes(p.id);
              const isFirst = index === 0;
              const isLast = index === allProducts.length - 1;
              return (
                <View key={p.id} style={[styles.row, isHidden && styles.rowHidden]}>
                  <View style={styles.reorderCol}>
                    <TouchableOpacity
                      onPress={() => { void runCatalogAction(() => moveProduct(p.id, -1)); }}
                      disabled={isFirst || saving}
                      style={styles.reorderBtn}
                      accessibilityLabel="Subir"
                    >
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={isFirst ? colors.textDisabled : colors.textMuted}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { void runCatalogAction(() => moveProduct(p.id, 1)); }}
                      disabled={isLast || saving}
                      style={styles.reorderBtn}
                      accessibilityLabel="Bajar"
                    >
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={isLast ? colors.textDisabled : colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => setEmojiTarget(p.id)}
                    disabled={saving}
                    style={styles.emojiTouch}
                    accessibilityLabel={t('settings.productEmojiHint')}
                  >
                    <ProductIcon value={p.emoji} size={sz(28)} style={styles.emoji} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.nameInput}
                    value={nameDrafts[p.id] ?? p.label}
                    onChangeText={(value) => setNameDrafts((current) => ({
                      ...current,
                      [p.id]: value,
                    }))}
                    placeholder={t('settings.productNamePlaceholder')}
                    placeholderTextColor={colors.textHint}
                    onEndEditing={(e) => {
                      const value = e.nativeEvent.text;
                      void runCatalogAction(
                        () => renameProduct(p.id, value),
                        () => setNameDrafts((current) => {
                          const next = { ...current };
                          delete next[p.id];
                          return next;
                        }),
                      );
                    }}
                    editable={!saving}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    onPress={() => {
                      void runCatalogAction(() => setProductHidden(p.id, !isHidden));
                    }}
                    disabled={saving}
                    style={styles.iconBtn}
                    accessibilityLabel={isHidden ? t('settings.showProduct') : t('settings.hideProduct')}
                  >
                    <Ionicons
                      name={isHidden ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                      color={isHidden ? colors.textHint : colors.primary}
                    />
                  </TouchableOpacity>
                  {isCustom(p.id) && (
                    <TouchableOpacity
                      onPress={() => handleDelete(p.id, p.label)}
                      disabled={saving || clientsLoading}
                      style={styles.iconBtn}
                      accessibilityLabel={t('delete')}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {/* Add new product */}
            <Text style={styles.addTitle}>{t('settings.addProductTitle')}</Text>
            <View style={styles.addRow}>
              <TouchableOpacity
                style={styles.emojiInput}
                onPress={() => setEmojiTarget(NEW_TARGET)}
                disabled={saving}
                accessibilityLabel={t('settings.productEmojiHint')}
              >
                <ProductIcon
                  value={newEmoji || '📦'}
                  size={sz(30)}
                  style={styles.emojiInputText}
                />
              </TouchableOpacity>
              <TextInput
                style={styles.addNameInput}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('settings.productNamePlaceholder')}
                placeholderTextColor={colors.textHint}
                editable={!saving}
              />
              <TextInput
                style={styles.shortInput}
                value={newShort}
                onChangeText={setNewShort}
                placeholder={t('settings.productShortPlaceholder')}
                placeholderTextColor={colors.textHint}
                maxLength={12}
                editable={!saving}
              />
            </View>
            <TouchableOpacity
              onPress={handleAdd}
              style={[styles.addBtn, !newName.trim() && styles.addBtnDisabled]}
              disabled={!newName.trim() || saving}
            >
              <Ionicons name="add" size={18} color={colors.textWhite} />
              <Text style={styles.addBtnText}>{t('settings.addProductBtn')}</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={requestClose} disabled={saving}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>

          {/* Emoji picker overlay */}
          {emojiTarget !== null && (
            <View style={styles.pickerBackdrop}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => closeEmojiPicker()}
                disabled={saving}
              />
              <View style={styles.pickerCard}>
                <Text style={styles.pickerTitle}>{t('settings.chooseEmoji')}</Text>
                <TextInput
                  style={styles.pickerSearch}
                  value={emojiSearch}
                  onChangeText={setEmojiSearch}
                  placeholder={t('settings.searchEmoji')}
                  placeholderTextColor={colors.textHint}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                />
                <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
                  {emojiResults ? (
                    emojiResults.length > 0 ? (
                      <View style={styles.emojiGrid}>
                        {emojiResults.map((item) => (
                          <TouchableOpacity
                            key={item}
                            style={styles.emojiChoice}
                            onPress={() => { void pickEmoji(item); }}
                            disabled={saving}
                          >
                            <ProductIcon
                              value={item}
                              size={sz(30)}
                              style={styles.emojiChoiceText}
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.pickerNoResults}>{t('settings.noEmojiResults')}</Text>
                    )
                  ) : (
                    <>
                      <View style={styles.pickerCategory}>
                        <Text style={styles.pickerCatTitle}>{t('settings.emojiStickers')}</Text>
                        <View style={styles.emojiGrid}>
                          {STICKER_IDS.map((id) => {
                            const value = STICKER_PREFIX + id;
                            return (
                              <TouchableOpacity
                                key={value}
                                style={styles.emojiChoice}
                                onPress={() => { void pickEmoji(value); }}
                                disabled={saving}
                              >
                                <ProductIcon value={value} size={sz(30)} />
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                      {EMOJI_CATEGORIES.map((cat) => (
                        <View key={cat.key} style={styles.pickerCategory}>
                          <Text style={styles.pickerCatTitle}>{t(`settings.emojiCat.${cat.key}`)}</Text>
                          <View style={styles.emojiGrid}>
                            {cat.emojis.map((e) => (
                              <TouchableOpacity
                                key={e}
                                style={styles.emojiChoice}
                                onPress={() => { void pickEmoji(e); }}
                                disabled={saving}
                              >
                                <ProductIcon
                                  value={e}
                                  size={sz(30)}
                                  style={styles.emojiChoiceText}
                                />
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </ScrollView>
                <View style={styles.pickerInputRow}>
                  <TextInput
                    style={styles.pickerInput}
                    value={emojiDraft}
                    onChangeText={setEmojiDraft}
                    placeholder={t('settings.typeEmoji')}
                    placeholderTextColor={colors.textHint}
                    maxLength={12}
                    onSubmitEditing={() => { void pickEmoji(emojiDraft); }}
                    returnKeyType="done"
                    editable={!saving}
                  />
                  <TouchableOpacity
                    style={[styles.pickerUseBtn, !emojiDraft.trim() && styles.pickerUseBtnDisabled]}
                    onPress={() => { void pickEmoji(emojiDraft); }}
                    disabled={!emojiDraft.trim() || saving}
                  >
                    <Text style={styles.pickerUseBtnText}>{t('settings.useEmoji')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: isTablet ? 'center' : 'flex-end',
      alignItems: 'center',
      paddingHorizontal: isTablet ? s(24) : s(8),
      paddingVertical: isTablet ? s(24) : 0,
    },
    modal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: s(20),
      borderTopRightRadius: s(20),
      borderBottomLeftRadius: isTablet ? s(20) : 0,
      borderBottomRightRadius: isTablet ? s(20) : 0,
      maxHeight: Platform.OS === 'android' ? '100%' : '90%',
      maxWidth: isTablet ? undefined : 600,
      alignSelf: 'center',
      width: isTablet ? modalWidth : '100%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: s(16),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: { fontSize: s(20), fontWeight: '700', color: colors.textPrimary },
    closeBtn: {
      width: s(32),
      height: s(32),
      borderRadius: s(16),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: { fontSize: s(18), color: colors.textMuted },
    body: { padding: s(16) },
    subtitle: { fontSize: s(14), color: colors.textMuted, marginBottom: s(14) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: s(6),
      gap: s(8),
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    rowHidden: { opacity: 0.45 },
    reorderCol: { width: s(24), alignItems: 'center', justifyContent: 'center' },
    reorderBtn: { paddingVertical: s(1) },
    emojiTouch: {
      width: s(36),
      height: s(36),
      borderRadius: s(8),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sectionBackground,
    },
    emoji: { fontSize: s(22), textAlign: 'center' },
    nameInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    iconBtn: { padding: s(6) },
    addTitle: {
      fontSize: s(15),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: s(22),
      marginBottom: s(10),
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: s(8) },
    emojiInput: {
      width: s(48),
      height: s(44),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    emojiInputText: { fontSize: s(22) },
    addNameInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    shortInput: {
      width: s(72),
      fontSize: s(15),
      textAlign: 'center',
      color: colors.textPrimary,
      paddingVertical: s(8),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(6),
      backgroundColor: colors.primary,
      paddingVertical: s(12),
      borderRadius: s(10),
      marginTop: s(12),
    },
    addBtnDisabled: { opacity: 0.5 },
    addBtnText: { color: colors.textWhite, fontSize: s(16), fontWeight: '700' },
    footer: {
      padding: s(16),
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    doneBtn: {
      backgroundColor: colors.sectionBackground,
      paddingVertical: s(14),
      borderRadius: s(12),
      alignItems: 'center',
    },
    doneBtnText: { color: colors.textPrimary, fontSize: s(17), fontWeight: '700' },
    pickerBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: s(24),
    },
    pickerCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.card,
      borderRadius: s(16),
      padding: s(16),
    },
    pickerTitle: {
      fontSize: s(16),
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: s(8),
    },
    pickerSearch: {
      fontSize: s(15),
      color: colors.textPrimary,
      paddingVertical: s(9),
      paddingHorizontal: s(12),
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.inputBorder,
      marginBottom: s(10),
    },
    pickerNoResults: {
      fontSize: s(14),
      color: colors.textMuted,
      textAlign: 'center',
      paddingVertical: s(24),
    },
    pickerScroll: { maxHeight: 320 },
    pickerCategory: { marginBottom: s(10) },
    pickerCatTitle: {
      fontSize: s(12),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: s(6),
    },
    emojiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6),
    },
    emojiChoice: {
      width: s(44),
      height: s(44),
      borderRadius: s(10),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sectionBackground,
    },
    emojiChoiceText: { fontSize: s(24) },
    pickerInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      marginTop: s(14),
    },
    pickerInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(10),
      paddingHorizontal: s(12),
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    pickerUseBtn: {
      paddingHorizontal: s(16),
      paddingVertical: s(10),
      borderRadius: s(10),
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerUseBtnDisabled: { opacity: 0.5 },
    pickerUseBtnText: { color: colors.textWhite, fontSize: s(15), fontWeight: '700' },
  });
};

export default ProductCatalogModal;
