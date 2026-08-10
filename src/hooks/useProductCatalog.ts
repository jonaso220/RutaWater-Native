import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { Product, PRODUCTS } from '../constants/products';
import { settingsDocId } from '../utils/helpers';
import firestore from '@react-native-firebase/firestore';

/**
 * Loads and mutates the editable product catalog stored in the shared
 * `settings/{groupId||uid}` document (same doc as the WhatsApp templates).
 * Four independent fields layer on top of the built-in PRODUCTS:
 *   - productNames:  { [id]: customLabel }   rename built-in or custom products
 *   - productHidden: string[]                ids to hide from product pickers
 *   - customProducts: Product[]              extra products added by the user
 *   - productOrder:  string[]                explicit display order of ids
 * Built-in ids are never mutated, so previously-saved client orders stay valid.
 */
export const useProductCatalog = (uid: string, groupId: string | undefined) => {
  const scopeKey = uid ? settingsDocId(uid, groupId) : '';
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [productEmojis, setProductEmojis] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [customProducts, setCustomProducts] = useState<Product[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [loadedScopeKey, setLoadedScopeKey] = useState('');
  const [generation, setGeneration] = useState(0);
  const [loadedGeneration, setLoadedGeneration] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const currentScopeKeyRef = useRef(scopeKey);
  const readyScopeKeyRef = useRef('');
  const generationRef = useRef(0);
  const readyGenerationRef = useRef(0);
  currentScopeKeyRef.current = scopeKey;
  const loaded = Boolean(
    scopeKey
    && loadedScopeKey === scopeKey
    && generation > 0
    && loadedGeneration === generation,
  );

  useEffect(() => {
    let active = true;
    const effectGeneration = generationRef.current + 1;
    generationRef.current = effectGeneration;
    readyGenerationRef.current = 0;
    setGeneration(effectGeneration);
    setLoadedGeneration(0);
    setProductNames({});
    setProductEmojis({});
    setHidden([]);
    setCustomProducts([]);
    setOrder([]);
    readyScopeKeyRef.current = '';
    setLoadedScopeKey('');
    setLoadError(false);

    if (!scopeKey) return () => { active = false; };

    const unsub = db
      .collection('settings')
      .doc(scopeKey)
      .onSnapshot(
        (doc) => {
          if (
            !active
            || currentScopeKeyRef.current !== scopeKey
            || generationRef.current !== effectGeneration
          ) return;
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
          readyScopeKeyRef.current = scopeKey;
          readyGenerationRef.current = effectGeneration;
          setLoadError(false);
          setLoadedScopeKey(scopeKey);
          setLoadedGeneration(effectGeneration);
        },
        (e) => {
          if (
            !active
            || currentScopeKeyRef.current !== scopeKey
            || generationRef.current !== effectGeneration
          ) return;
          readyScopeKeyRef.current = '';
          readyGenerationRef.current = 0;
          setLoadedScopeKey('');
          setLoadedGeneration(0);
          setLoadError(true);
          setProductNames({});
          setProductEmojis({});
          setHidden([]);
          setCustomProducts([]);
          setOrder([]);
          reportError(e, 'Error loading product catalog');
        },
      );
    return () => {
      active = false;
      unsub();
    };
  }, [loadAttempt, scopeKey]);

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
      if (!scopeKey) throw new Error('PRODUCT_CATALOG_USER_REQUIRED');
      if (
        currentScopeKeyRef.current !== scopeKey
        || readyScopeKeyRef.current !== scopeKey
        || loadedScopeKey !== scopeKey
        || generation <= 0
        || generationRef.current !== generation
        || readyGenerationRef.current !== generation
        || loadedGeneration !== generation
      ) throw new Error('PRODUCT_CATALOG_SCOPE_NOT_READY');
      try {
        await db
          .collection('settings')
          .doc(scopeKey)
          .set(patch, { merge: true });
      } catch (e) {
        reportError(e, 'Error saving product catalog');
        throw e;
      }
    },
    [generation, loadedGeneration, loadedScopeKey, scopeKey],
  );

  const canApplyLocalResult = useCallback(
    () => (
      currentScopeKeyRef.current === scopeKey
      && readyScopeKeyRef.current === scopeKey
      && generationRef.current === generation
      && readyGenerationRef.current === generation
    ),
    [generation, scopeKey],
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
      if (!canApplyLocalResult()) return;
      setProductNames(next);
    },
    [canApplyLocalResult, productNames, persist],
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
      if (!canApplyLocalResult()) return;
      setProductEmojis(next);
    },
    [canApplyLocalResult, productEmojis, persist],
  );

  const setProductHidden = useCallback(
    async (id: string, hide: boolean) => {
      const next = hide ? [...new Set([...hidden, id])] : hidden.filter((h) => h !== id);
      await persist({ productHidden: next });
      if (!canApplyLocalResult()) return;
      setHidden(next);
    },
    [canApplyLocalResult, hidden, persist],
  );

  const addProduct = useCallback(
    async ({ label, emoji, short }: { label: string; emoji: string; short: string }) => {
      const name = label.trim();
      if (!name) return;
      const newProduct: Product = {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: name,
        icon: 'cube',
        emoji: emoji.trim() || '📦',
        short: (short.trim() || name).slice(0, 12),
      };
      await persist({ customProducts: firestore.FieldValue.arrayUnion(newProduct) });
      if (!canApplyLocalResult()) return;
      setCustomProducts((current) => (
        current.some((product) => product.id === newProduct.id)
          ? current
          : [...current, newProduct]
      ));
    },
    [canApplyLocalResult, persist],
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
      if (!canApplyLocalResult()) return;
      setOrder(ids);
    },
    [allProducts, canApplyLocalResult, persist],
  );

  return {
    products,
    allProducts,
    customProducts,
    hidden,
    productNames,
    productEmojis,
    order,
    scopeKey,
    generation,
    loaded,
    loadError,
    reload: () => setLoadAttempt((attempt) => attempt + 1),
    renameProduct,
    setProductEmoji,
    setProductHidden,
    addProduct,
    moveProduct,
  };
};
