import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { Product, PRODUCTS } from '../constants/products';
import { settingsDocId } from '../utils/helpers';

/**
 * Loads and mutates the editable product catalog stored in the shared
 * `settings/{groupId||uid}` document (same doc as the WhatsApp templates).
 * Four independent fields layer on top of the built-in PRODUCTS:
 *   - productNames:  { [id]: customLabel }   rename built-in or custom products
 *   - productHidden: string[]                ids to hide from pickers/counter
 *   - customProducts: Product[]              extra products added by the user
 *   - productOrder:  string[]                explicit display order of ids
 * Built-in ids are never mutated, so previously-saved client orders stay valid.
 */
export const useProductCatalog = (uid: string, groupId: string | undefined) => {
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [productEmojis, setProductEmojis] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [customProducts, setCustomProducts] = useState<Product[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = db
      .collection('settings')
      .doc(settingsDocId(uid, groupId))
      .onSnapshot(
        (doc) => {
          const data = doc.data() || {};
          setProductNames(
            data.productNames && typeof data.productNames === 'object' ? data.productNames : {},
          );
          setProductEmojis(
            data.productEmojis && typeof data.productEmojis === 'object' ? data.productEmojis : {},
          );
          setHidden(Array.isArray(data.productHidden) ? data.productHidden : []);
          setCustomProducts(Array.isArray(data.customProducts) ? data.customProducts : []);
          setOrder(Array.isArray(data.productOrder) ? data.productOrder : []);
          setLoaded(true);
        },
        (e) => {
          reportError(e, 'Error loading product catalog');
          setLoaded(true);
        },
      );
    return unsub;
  }, [uid, groupId]);

  const applyOverrides = useCallback(
    (p: Product): Product => ({
      ...p,
      label: productNames[p.id] ?? p.label,
      emoji: productEmojis[p.id] ?? p.emoji,
    }),
    [productNames, productEmojis],
  );

  const allProducts = useMemo<Product[]>(() => {
    const all = [...PRODUCTS.map(applyOverrides), ...customProducts.map(applyOverrides)];
    // Products listed in `order` come first (in that order); anything not yet
    // ranked (e.g. a just-added product) keeps its default position at the end.
    const ranked = order.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Product[];
    const rest = all.filter((p) => !order.includes(p.id));
    return [...ranked, ...rest];
  }, [applyOverrides, customProducts, order]);

  const products = useMemo<Product[]>(
    () => allProducts.filter((p) => !hidden.includes(p.id)),
    [allProducts, hidden],
  );

  const persist = useCallback(
    async (patch: Record<string, any>) => {
      if (!uid) throw new Error('PRODUCT_CATALOG_USER_REQUIRED');
      try {
        await db
          .collection('settings')
          .doc(settingsDocId(uid, groupId))
          .set(patch, { merge: true });
      } catch (e) {
        reportError(e, 'Error saving product catalog');
        throw e;
      }
    },
    [uid, groupId],
  );

  const renameProduct = useCallback(
    async (id: string, label: string) => {
      const trimmed = label.trim();
      const next = { ...productNames };
      const base = PRODUCTS.find((p) => p.id === id);
      // Empty, or back to the built-in default name → drop the override entirely.
      if (!trimmed || (base && base.label === trimmed)) {
        delete next[id];
      } else {
        next[id] = trimmed;
      }
      await persist({ productNames: next });
      setProductNames(next);
    },
    [productNames, persist],
  );

  const setProductEmoji = useCallback(
    async (id: string, emoji: string) => {
      const value = emoji.trim();
      if (!value) return;
      const base = PRODUCTS.find((p) => p.id === id);
      const next = { ...productEmojis };
      // Back to the built-in default emoji → drop the override.
      if (base && base.emoji === value) {
        delete next[id];
      } else {
        next[id] = value;
      }
      await persist({ productEmojis: next });
      setProductEmojis(next);
    },
    [productEmojis, persist],
  );

  const setProductHidden = useCallback(
    async (id: string, hide: boolean) => {
      const next = hide ? [...new Set([...hidden, id])] : hidden.filter((h) => h !== id);
      await persist({ productHidden: next });
      setHidden(next);
    },
    [hidden, persist],
  );

  const addProduct = useCallback(
    async ({ label, emoji, short }: { label: string; emoji: string; short: string }) => {
      const name = label.trim();
      if (!name) return;
      const newProduct: Product = {
        id: `custom_${Date.now()}`,
        label: name,
        icon: 'cube',
        emoji: emoji.trim() || '📦',
        short: (short.trim() || name).slice(0, 12),
      };
      const next = [...customProducts, newProduct];
      await persist({ customProducts: next });
      setCustomProducts(next);
    },
    [customProducts, persist],
  );

  const removeCustomProduct = useCallback(
    async (id: string) => {
      const nextCustom = customProducts.filter((c) => c.id !== id);
      const nextNames = { ...productNames };
      delete nextNames[id];
      const nextEmojis = { ...productEmojis };
      delete nextEmojis[id];
      const nextHidden = hidden.filter((h) => h !== id);
      const nextOrder = order.filter((o) => o !== id);
      await persist({
        customProducts: nextCustom,
        productNames: nextNames,
        productEmojis: nextEmojis,
        productHidden: nextHidden,
        productOrder: nextOrder,
      });
      setCustomProducts(nextCustom);
      setProductNames(nextNames);
      setProductEmojis(nextEmojis);
      setHidden(nextHidden);
      setOrder(nextOrder);
    },
    [customProducts, productNames, productEmojis, hidden, order, persist],
  );

  const moveProduct = useCallback(
    async (id: string, dir: -1 | 1) => {
      // Persist the full current ordering with `id` swapped one slot in `dir`.
      const ids = allProducts.map((p) => p.id);
      const idx = ids.indexOf(id);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= ids.length) return;
      [ids[idx], ids[target]] = [ids[target], ids[idx]];
      await persist({ productOrder: ids });
      setOrder(ids);
    },
    [allProducts, persist],
  );

  return {
    products,
    allProducts,
    customProducts,
    hidden,
    productNames,
    productEmojis,
    order,
    loaded,
    renameProduct,
    setProductEmoji,
    setProductHidden,
    addProduct,
    removeCustomProduct,
    moveProduct,
  };
};
