import type { Product } from '../constants/products';

export interface ProductQuantitiesSource {
  products?: Record<string, string | number> | null;
}

/**
 * Totals every catalog product that still exists in scheduled client data.
 * Callers must pass the complete catalog, including hidden products: hiding a
 * product prevents new selection but must never make an existing load vanish.
 */
export const calculateProductTotals = (
  clients: readonly ProductQuantitiesSource[],
  products: readonly Pick<Product, 'id'>[],
): Record<string, number> => {
  const totals: Record<string, number> = {};
  products.forEach((product) => {
    totals[product.id] = 0;
  });

  clients.forEach((client) => {
    if (!client.products) return;
    products.forEach((product) => {
      const quantity = Number.parseInt(String(client.products?.[product.id] || 0), 10);
      if (quantity > 0) totals[product.id] += quantity;
    });
  });

  return totals;
};
