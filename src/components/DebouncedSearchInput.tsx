import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  StyleProp,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

export interface DebouncedSearchInputHandle {
  clear: () => void;
}

interface DebouncedSearchInputProps {
  onDebouncedChange: (term: string) => void;
  placeholder: string;
  placeholderTextColor: string;
  delayMs?: number;
  wrapperStyle: StyleProp<ViewStyle>;
  iconStyle: StyleProp<TextStyle>;
  inputStyle: StyleProp<TextStyle>;
  clearButtonStyle: StyleProp<ViewStyle>;
  clearTextStyle: StyleProp<TextStyle>;
}

/**
 * Search box that owns its keystroke state. Only the debounced term reaches
 * the parent, so typing re-renders this input instead of the whole screen
 * (and its list) on every character.
 */
const DebouncedSearchInput = forwardRef<DebouncedSearchInputHandle, DebouncedSearchInputProps>(({
  onDebouncedChange,
  placeholder,
  placeholderTextColor,
  delayMs = 300,
  wrapperStyle,
  iconStyle,
  inputStyle,
  clearButtonStyle,
  clearTextStyle,
}, ref) => {
  const [value, setValue] = useState('');
  const onDebouncedChangeRef = useRef(onDebouncedChange);
  onDebouncedChangeRef.current = onDebouncedChange;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleChangeText = useCallback((text: string) => {
    setValue(text);
    cancelPending();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onDebouncedChangeRef.current(text);
    }, delayMs);
  }, [delayMs]);

  const clear = useCallback(() => {
    cancelPending();
    setValue('');
    onDebouncedChangeRef.current('');
  }, []);

  useImperativeHandle(ref, () => ({ clear }), [clear]);

  useEffect(() => cancelPending, []);

  return (
    <View style={wrapperStyle}>
      <Text style={iconStyle}>🔍</Text>
      <TextInput
        style={inputStyle}
        value={value}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        autoCorrect={false}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={clear} style={clearButtonStyle}>
          <Text style={clearTextStyle}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

export default React.memo(DebouncedSearchInput);
