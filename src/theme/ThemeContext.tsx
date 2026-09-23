import React, {createContext, useContext, useMemo, useSyncExternalStore} from 'react';
import {Appearance} from 'react-native';
import {lightColors, darkColors, ThemeColors} from './colors';

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  colors: lightColors,
  isDark: false,
});

// Subscribe to Appearance changes using useSyncExternalStore for zero-flash
const subscribe = (callback: () => void) => {
  const listener = Appearance.addChangeListener(callback);
  return () => listener.remove();
};

const getSnapshot = () => Appearance.getColorScheme() === 'dark';

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // A new value object on every provider render would re-render every
  // useTheme() consumer; it only needs to change with the color scheme.
  const value = useMemo(
    () => ({colors: isDark ? darkColors : lightColors, isDark}),
    [isDark],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
