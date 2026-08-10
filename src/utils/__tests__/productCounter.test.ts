import { calculateProductTotals } from '../productCounter';

const products = [
  { id: 'b20' },
  { id: 'b12' },
  { id: 'soda' },
];

describe('calculateProductTotals', () => {
  test('includes a hidden catalog product that still has scheduled quantities', () => {
    const allProducts = products;
    const visibleProducts = products.filter((product) => product.id !== 'b12');
    const clients = [{ products: { b20: 2, b12: 8 } }];

    expect(calculateProductTotals(clients, allProducts)).toEqual({
      b20: 2,
      b12: 8,
      soda: 0,
    });
    expect(calculateProductTotals(clients, visibleProducts)).not.toHaveProperty('b12');
  });

  test('keeps the load visible when every scheduled quantity belongs to a hidden product', () => {
    const totals = calculateProductTotals(
      [{ products: { b12: '4' } }],
      products,
    );

    expect(totals.b12).toBe(4);
    expect(Object.values(totals).some((quantity) => quantity > 0)).toBe(true);
  });

  test('sums numeric strings and ignores zero, negative and invalid quantities', () => {
    expect(calculateProductTotals([
      { products: { b20: '2', b12: 0, soda: '12' } },
      { products: { b20: 3, b12: -2, soda: 'invalid' } },
      { products: null },
    ], products)).toEqual({
      b20: 5,
      b12: 0,
      soda: 12,
    });
  });
});
