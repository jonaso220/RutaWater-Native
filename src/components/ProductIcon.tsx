import React from 'react';
import {
  Image,
  Text,
  View,
  StyleSheet,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { STICKERS } from '../assets/stickers';

// A product icon is stored in the `emoji` field. When it starts with this
// prefix it's a bundled sticker image; otherwise it's a plain emoji/text.
export const STICKER_PREFIX = 'sticker:';

export const isSticker = (v?: string): boolean =>
  !!v && v.startsWith(STICKER_PREFIX);

export const stickerSource = (v?: string) =>
  isSticker(v) ? STICKERS[v!.slice(STICKER_PREFIX.length)] : undefined;

interface IconProps {
  value?: string;
  size: number;
  style?: StyleProp<TextStyle>; // applied only to the emoji (text) fallback
}

// Standalone icon: a sticker image when value is `sticker:<id>`, else the emoji.
export const ProductIcon: React.FC<IconProps> = ({ value, size, style }) => {
  const src = stickerSource(value);
  if (src) {
    return (
      <Image
        source={src}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }
  return <Text style={style}>{value}</Text>;
};

interface LabelProps {
  value?: string;
  label: string;
  size: number;
  style?: StyleProp<TextStyle>; // text style for the emoji+label / label
  containerStyle?: StyleProp<ViewStyle>; // sticker case wrapper (e.g. chip bg)
}

// Inline "icon + label" for product rows/chips. Emojis keep their original
// single <Text> (preserving spacing/baseline); stickers lay out a small image
// next to the label. For chip styles whose background lives on the text itself,
// pass it as containerStyle (it's applied to the wrapper View in the sticker
// case and merged into the Text in the emoji case).
export const ProductLabel: React.FC<LabelProps> = ({
  value,
  label,
  size,
  style,
  containerStyle,
}) => {
  const src = stickerSource(value);
  if (src) {
    return (
      <View style={[styles.row, containerStyle]}>
        <Image
          source={src}
          style={{ width: size, height: size, marginRight: size * 0.28 }}
          resizeMode="contain"
        />
        <Text style={style}>{label}</Text>
      </View>
    );
  }
  return (
    <Text style={[containerStyle as StyleProp<TextStyle>, style]}>
      {value ?? ''} {label}
    </Text>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});

export default ProductIcon;
