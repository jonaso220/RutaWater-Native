import { useWindowDimensions } from 'react-native';
import { getResponsiveLayout } from '../utils/responsiveLayout';

export const useLayout = () => {
  const { width, height } = useWindowDimensions();
  return getResponsiveLayout(width, height);
};

/** Helper: scale a font size */
export const fs = (base: number, scale: number) => Math.round(base * scale);
