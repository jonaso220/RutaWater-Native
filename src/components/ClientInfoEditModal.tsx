import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { getModalWidth } from '../utils/helpers';

interface ClientInfoEditModalProps {
  visible: boolean;
  onClose: () => void;
  name: string;
  address: string;
  phone: string;
  mapsLink: string;
  setName: (s: string) => void;
  setAddress: (s: string) => void;
  setPhone: (s: string) => void;
  setMapsLink: (s: string) => void;
}

const ClientInfoEditModal: React.FC<ClientInfoEditModalProps> = ({
  visible,
  onClose,
  name,
  address,
  phone,
  mapsLink,
  setName,
  setAddress,
  setPhone,
  setMapsLink,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth);

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('editModal.clientData')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                value={name}
                onChangeText={setName}
                placeholder={t('editModal.namePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              {name.length > 0 && (
                <TouchableOpacity onPress={() => setName('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                value={address}
                onChangeText={setAddress}
                placeholder={t('editModal.addressPlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              {address.length > 0 && (
                <TouchableOpacity onPress={() => setAddress('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                value={phone}
                onChangeText={setPhone}
                placeholder={t('editModal.phonePlaceholder')}
                placeholderTextColor={colors.textHint}
                keyboardType="phone-pad"
              />
              {phone.length > 0 && (
                <TouchableOpacity onPress={() => setPhone('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                value={mapsLink}
                onChangeText={setMapsLink}
                placeholder={t('editModal.mapsPlaceholder')}
                placeholderTextColor={colors.textHint}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {mapsLink.length > 0 && (
                <TouchableOpacity onPress={() => setMapsLink('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: isTablet ? 'center' : 'flex-end',
    alignItems: 'center',
    paddingHorizontal: isTablet ? 24 : 8,
    paddingVertical: isTablet ? 24 : 0,
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: isTablet ? 20 : 0,
    borderBottomRightRadius: isTablet ? 20 : 0,
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '85%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: colors.textMuted,
  },
  body: {
    padding: 16,
  },
  fieldInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: 10,
  },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 32 : 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  doneBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: {
    color: colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
  },
});

export default ClientInfoEditModal;
