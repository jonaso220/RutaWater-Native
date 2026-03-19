import React, {createContext, useContext, useSyncExternalStore} from 'react';
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
  const colors = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{colors, isDark}}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
