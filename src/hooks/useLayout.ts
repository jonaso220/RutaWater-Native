import { useWindowDimensions } from 'react-native';

const MAX_CONTENT_WIDTH = 600;

export const useLayout = () => {
  const { width } = useWindowDimensions();
  const isWide = width > MAX_CONTENT_WIDTH;
  // Scale factor: 1.0 on phones, ramping up to 1.5 on wide screens (iPad/Mac)
  // so text/controls don't look tiny on a large display. Consumed app-wide
  // (screens, cards, modals, sheets) for consistent scaling.
  const fontScale = isWide ? Math.min(1.5, Math.max(1, width / 700)) : 1;
  return { isWide, MAX_CONTENT_WIDTH, fontScale, width };
};

/** Helper: scale a font size */
export const fs = (base: number, scale: number) => Math.round(base * scale);
