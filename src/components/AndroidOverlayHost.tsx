import React, { createContext, useContext, useLayoutEffect, useMemo, useId, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

type OverlayKey = string;
interface OverlayHost {
  set: (key: OverlayKey, content: React.ReactNode) => void;
  remove: (key: OverlayKey) => void;
}
const OverlayContext = createContext<OverlayHost | null>(null);

// Keep overlays opened from list cells outside their clipping and touch bounds.
// The host retains the existing Android View-based modal workaround for Fabric.
export const AndroidOverlayProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [overlays, setOverlays] = useState<Map<OverlayKey, React.ReactNode>>(() => new Map());
  const host = useMemo<OverlayHost>(() => ({
    set: (key, content) => setOverlays(current => new Map(current).set(key, content)),
    remove: key => setOverlays(current => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    }),
  }), []);

  if (Platform.OS !== 'android') return <>{children}</>;

  return (
    <OverlayContext.Provider value={host}>
      <View style={styles.root}>
        <View style={styles.root} pointerEvents={overlays.size ? 'none' : 'auto'}
          importantForAccessibility={overlays.size ? 'no-hide-descendants' : 'auto'}>
          {children}
        </View>
        {Array.from(overlays, ([key, content]) => (
          <View key={key} style={styles.overlay} accessibilityViewIsModal>
            {content}
          </View>
        ))}
      </View>
    </OverlayContext.Provider>
  );
};

export const AndroidScreenOverlay: React.FC<{children: React.ReactNode}> = ({children}) => {
  const host = useContext(OverlayContext);
  const key = useId();
  useLayoutEffect(() => {
    host?.set(key, children);
  }, [host, key, children]);
  useLayoutEffect(() => () => host?.remove(key), [host, key]);
  return null;
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
});
