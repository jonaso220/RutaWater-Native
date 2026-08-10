import { create } from 'zustand';
import { Product, PRODUCTS } from '../constants/products';

/**
 * Editable product catalog. The 8 built-in products (PRODUCTS) keep their
 * Firestore ids forever so existing client data never breaks; on top of them
 * the user can rename, hide, or add custom products. The catalog is persisted
 * per group/user in the `settings` document (see useProductCatalog) and bridged
 * here by StoreSync so every component reads the same live list.
 *
 *  - `products`    visible list (built-in + custom, minus hidden, names applied)
 *  - `allProducts` same but INCLUDING hidden ones, used to resolve labels for
 *                  products a client already ordered before they were hidden.
 */
interface ProductCatalogStore {
  products: Product[];
  allProducts: Product[];
  customProducts: Product[];
  hidden: string[];
  productNames: Record<string, string>;
  loaded: boolean;
  renameProduct: (id: string, label: string) => Promise<void>;
  setProductEmoji: (id: string, emoji: string) => Promise<void>;
  setProductHidden: (id: string, hidden: boolean) => Promise<void>;
  addProduct: (p: { label: string; emoji: string; short: string }) => Promise<void>;
  removeCustomProduct: (id: string) => Promise<void>;
  // Move a product one slot up (dir = -1) or down (dir = +1) within the full list.
  moveProduct: (id: string, dir: -1 | 1) => Promise<void>;
}

const noop = async () => {};

export const useProductCatalogStore = create<ProductCatalogStore>()(() => ({
  products: PRODUCTS,
  allProducts: PRODUCTS,
  customProducts: [],
  hidden: [],
  productNames: {},
  loaded: false,
  renameProduct: noop,
  setProductEmoji: noop,
  setProductHidden: noop,
  addProduct: noop,
  removeCustomProduct: noop,
  moveProduct: noop,
}));

/** Visible products (built-in + custom, minus hidden). Use in pickers. */
export const useProducts = () => useProductCatalogStore((s) => s.products);

/** All products including hidden ones. Use for existing data and load totals. */
export const useAllProducts = () => useProductCatalogStore((s) => s.allProducts);
