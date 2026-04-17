import React, { useEffect } from 'react';
import {
  View,
  StyleSheet,
  BackHandler,
  Platform,
  Modal,
  useWindowDimensions,
} from 'react-native';

interface ModalOverlayProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  animationType?: 'none' | 'slide' | 'fade';
}

/**
 * Cross-platform modal that works around the React Native Modal bug
 * on Android with New Architecture (Fabric) where content renders
 * with zero width.
 *
 * On iOS: uses the native <Modal> component (unchanged behavior).
 * On Android: renders as an absolute-positioned overlay within
 *   the parent bounds. Since the parent is already constrained
 *   (between header and tab bar), modals get full available space.
 */
const ModalOverlay: React.FC<ModalOverlayProps> = ({
  visible,
  onClose,
  children,
  animationType = 'slide',
}) => {
  // Force wrapper to follow window size. On iPadOS apps running on Mac, the
  // native Modal's hosting view does not always resize with the app window,
  // which leaves flex-based children misaligned. Pinning explicit dimensions
  // guarantees the overlay fills the entire window so children center correctly.
  const { width, height } = useWindowDimensions();

  // Handle Android back button
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  // iOS/macOS: use native Modal with flex wrapper for proper centering
  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} animationType={animationType} transparent>
        <View style={[styles.iosWrapper, { width, height }]}>
          {children}
        </View>
      </Modal>
    );
  }

  // Android: render as absolute overlay within parent bounds
  if (!visible) return null;

  return (
    <View style={styles.androidOverlay}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  iosWrapper: {
    flex: 1,
  },
  androidOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
});

export default ModalOverlay;
