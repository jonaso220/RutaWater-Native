import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { useLayout } from '../hooks/useLayout';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { ThemeColors } from '../theme/colors';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { PACKAGE_TYPE } from 'react-native-purchases';

interface Props {
  navigation: any;
}

const PaywallScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
  const { packages, purchasePackage, restorePurchases, isPremium } = useSubscriptionContext();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const monthlyPkg = packages.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY);
  const annualPkg = packages.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL);

  const handlePurchase = async (pkg: typeof monthlyPkg) => {
    if (!pkg) return;
    setPurchasing(true);
    try {
      const success = await purchasePackage(pkg);
      if (success) {
        Alert.alert('Bienvenido a Premium!', 'Ya tienes acceso a todas las funciones.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (error: any) {
      Alert.alert('Error', 'No se pudo completar la compra. Intenta de nuevo.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      if (restored) {
        Alert.alert('Compras restauradas', 'Tu suscripcion Premium ha sido restaurada.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('Sin compras', 'No se encontraron compras previas para restaurar.');
      }
    } catch {
      Alert.alert('Error', 'No se pudieron restaurar las compras.');
    } finally {
      setRestoring(false);
    }
  };

  if (isPremium) {
    return (
      <View style={styles.container}>
        <View style={styles.premiumActive}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          <Text style={styles.premiumActiveTitle}>Ya eres Premium</Text>
          <Text style={styles.premiumActiveSubtitle}>
            Tienes acceso a todas las funciones.
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Volver</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Ionicons name="close" size={28} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Ionicons name="diamond" size={40} color={colors.primary} />
        </View>
        <Text style={styles.title}>RutaWater Premium</Text>
        <Text style={styles.subtitle}>Desbloquea todo el potencial de tu ruta</Text>
      </View>

      {/* Features */}
      <View style={styles.featuresCard}>
        <FeatureRow
          icon="people"
          title="Clientes ilimitados"
          description={`Sin limite de ${FREE_CLIENT_LIMIT} clientes`}
          colors={colors}
          fontScale={fontScale}
        />
        <FeatureRow
          icon="person-add"
          title="Grupos de trabajo"
          description="Crea y unite a grupos colaborativos"
          colors={colors}
          fontScale={fontScale}
        />
        <FeatureRow
          icon="download"
          title="Exportar datos"
          description="Exporta tus clientes en CSV y JSON"
          colors={colors}
          fontScale={fontScale}
        />
      </View>

      {/* Trial badge */}
      <View style={styles.trialBadge}>
        <Ionicons name="gift" size={18} color={colors.success} />
        <Text style={styles.trialText}>1 mes de prueba gratis</Text>
      </View>

      {/* Pricing */}
      <View style={styles.pricingSection}>
        <TouchableOpacity
          onPress={() => monthlyPkg ? handlePurchase(monthlyPkg) : Alert.alert('No disponible', 'Las compras no estan disponibles en este momento. Intenta mas tarde.')}
          style={styles.priceCard}
          disabled={purchasing}
        >
          <Text style={styles.priceLabel}>Mensual</Text>
          <Text style={styles.priceAmount}>
            {monthlyPkg ? monthlyPkg.product.priceString : '$2.99'}
          </Text>
          <Text style={styles.pricePeriod}>por mes</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => annualPkg ? handlePurchase(annualPkg) : Alert.alert('No disponible', 'Las compras no estan disponibles en este momento. Intenta mas tarde.')}
          style={[styles.priceCard, styles.priceCardFeatured]}
          disabled={purchasing}
        >
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>Ahorra ~16%</Text>
          </View>
          <Text style={[styles.priceLabel, styles.priceLabelFeatured]}>Anual</Text>
          <Text style={[styles.priceAmount, styles.priceAmountFeatured]}>
            {annualPkg ? annualPkg.product.priceString : '$29.99'}
          </Text>
          <Text style={[styles.pricePeriod, styles.pricePeriodFeatured]}>por ano</Text>
        </TouchableOpacity>
      </View>

      {purchasing && (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
      )}

      {/* Restore */}
      <TouchableOpacity onPress={handleRestore} disabled={restoring} style={styles.restoreBtn}>
        {restoring ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <Text style={styles.restoreText}>Restaurar compras</Text>
        )}
      </TouchableOpacity>

      {/* Legal */}
      <Text style={styles.legalText}>
        El pago se cargara a tu cuenta de {Platform.OS === 'ios' ? 'Apple' : 'Google'}.
        La suscripcion se renueva automaticamente a menos que se cancele al menos 24 horas
        antes del final del periodo actual. Puedes gestionar tu suscripcion desde los ajustes
        de tu dispositivo.
      </Text>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const FeatureRow: React.FC<{
  icon: string;
  title: string;
  description: string;
  colors: ThemeColors;
  fontScale: number;
}> = ({ icon, title, description, colors, fontScale }) => {
  const s = (v: number) => Math.round(v * fontScale);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.primaryLighter,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Ionicons name={icon as any} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: s(16), fontWeight: '700', color: colors.textPrimary }}>
          {title}
        </Text>
        <Text style={{ fontSize: s(13), color: colors.textMuted, marginTop: 2 }}>
          {description}
        </Text>
      </View>
      <Ionicons name="checkmark-circle" size={22} color={colors.success} />
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
    },
    backBtn: {
      alignSelf: 'flex-end',
      padding: 4,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
    },
    iconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primaryLighter,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 2,
      borderColor: colors.primaryBorder,
    },
    title: {
      fontSize: s(26),
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: s(16),
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 6,
    },
    featuresCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    trialBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 16,
      backgroundColor: colors.successBg,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.successBorder,
    },
    trialText: {
      fontSize: s(15),
      fontWeight: '700',
      color: colors.successText,
    },
    pricingSection: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
    },
    priceCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.cardBorder,
    },
    priceCardFeatured: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLighter,
    },
    saveBadge: {
      position: 'absolute',
      top: -10,
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 8,
    },
    saveBadgeText: {
      color: '#FFFFFF',
      fontSize: s(11),
      fontWeight: '700',
    },
    priceLabel: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 4,
    },
    priceLabelFeatured: {
      color: colors.primary,
    },
    priceAmount: {
      fontSize: s(28),
      fontWeight: '800',
      color: colors.textPrimary,
    },
    priceAmountFeatured: {
      color: colors.primary,
    },
    pricePeriod: {
      fontSize: s(13),
      color: colors.textHint,
      marginTop: 2,
    },
    pricePeriodFeatured: {
      color: colors.primary,
    },
    loadingPackages: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 20,
    },
    loadingText: {
      fontSize: s(14),
      color: colors.textMuted,
    },
    restoreBtn: {
      marginTop: 20,
      alignItems: 'center',
      paddingVertical: 12,
    },
    restoreText: {
      fontSize: s(14),
      color: colors.textMuted,
      textDecorationLine: 'underline',
    },
    legalText: {
      fontSize: s(11),
      color: colors.textHint,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: s(16),
    },
    premiumActive: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    },
    premiumActiveTitle: {
      fontSize: s(24),
      fontWeight: '800',
      color: colors.textPrimary,
      marginTop: 16,
    },
    premiumActiveSubtitle: {
      fontSize: s(16),
      color: colors.textMuted,
      marginTop: 8,
      textAlign: 'center',
    },
    closeBtn: {
      marginTop: 24,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 40,
      borderRadius: 12,
    },
    closeBtnText: {
      color: '#FFFFFF',
      fontSize: s(16),
      fontWeight: '700',
    },
  });
};

export default PaywallScreen;
