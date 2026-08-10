import type { Product } from '../constants/products';

export interface ProductQuantitiesSource {
  products?: Record<string, string | number> | null;
}

const positiveQuantity = (value: string | number | undefined): number => {
  const quantity = Number.parseInt(String(value || 0), 10);
  return quantity > 0 ? quantity : 0;
};

/**
 * Totals every product that exists in scheduled client data. Catalog entries
 * establish the normal display order, while IDs no longer present in the
 * catalog are still retained so deleting a descriptor cannot hide a load.
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
    Object.entries(client.products || {}).forEach(([productId, value]) => {
      const quantity = positiveQuantity(value);
      if (quantity > 0) totals[productId] = (totals[productId] || 0) + quantity;
    });
  });

  return totals;
};
