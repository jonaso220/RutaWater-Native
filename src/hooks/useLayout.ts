import { useWindowDimensions } from 'react-native';

const MAX_CONTENT_WIDTH = 600;

export const useLayout = () => {
  const { width } = useWindowDimensions();
  const isWide = width > MAX_CONTENT_WIDTH;
  // Scale factor: 1.0 on phones, up to 1.3 on wide screens
  const fontScale = isWide ? Math.min(1.3, width / MAX_CONTENT_WIDTH) : 1;
  return { isWide, MAX_CONTENT_WIDTH, fontScale, width };
};

/** Helper: scale a font size */
export const fs = (base: number, scale: number) => Math.round(base * scale);
