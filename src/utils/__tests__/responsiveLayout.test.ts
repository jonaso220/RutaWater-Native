import { getResponsiveLayout } from '../responsiveLayout';

describe('responsive layout when rotating a phone', () => {
  it.each([
    [320, 568],
    [375, 667],
    [390, 844],
    [440, 956],
  ])('keeps phone-sized UI in both orientations at %i x %i', (width, height) => {
    const portrait = getResponsiveLayout(width, height);
    const landscape = getResponsiveLayout(height, width);

    expect(portrait.fontScale).toBe(1);
    expect(landscape.fontScale).toBe(portrait.fontScale);
    expect(portrait.isWide).toBe(false);
    expect(landscape.isWide).toBe(false);
    expect(portrait.isPhoneLandscape).toBe(false);
    expect(landscape.isPhoneLandscape).toBe(true);
  });

  it.each([
    [768, 1024],
    [1024, 1366],
  ])('preserves the larger tablet layout at %i x %i', (width, height) => {
    for (const [w, h] of [[width, height], [height, width]]) {
      const layout = getResponsiveLayout(w, h);
      expect(layout.isPhoneLandscape).toBe(false);
      expect(layout.isWide).toBe(true);
      expect(layout.fontScale).toBe(Math.min(1.5, Math.max(1, w / 700)));
    }
  });

  it('uses compact UI for a short resizable window and restores it when expanded', () => {
    expect(getResponsiveLayout(1000, 550).isPhoneLandscape).toBe(true);
    expect(getResponsiveLayout(1000, 550).fontScale).toBe(1);
    expect(getResponsiveLayout(1000, 800).isWide).toBe(true);
    expect(getResponsiveLayout(1000, 800).fontScale).toBeGreaterThan(1);
  });
});
