import React, { useState } from 'react';
import {
  ActivityIndicator, Dimensions, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { scanImage } from '@/src/api';
import { useToast } from '@/src/toast';

const { height: SCREEN_H } = Dimensions.get('window');

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState('Detecting spines…');
  const [step, setStep] = useState(0); // 0,1,2

  const runScan = async (uri: string) => {
    setProcessing(true);
    setStep(0);
    setStatus('Detecting spines…');
    try {
      const t1 = setTimeout(() => { setStatus('Reading titles…'); setStep(1); }, 2500);
      const t2 = setTimeout(() => { setStatus('Matching your catalog…'); setStep(2); }, 8000);
      const result = await scanImage(uri, 90000);
      clearTimeout(t1); clearTimeout(t2);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.detected_count === 0) {
        toast.show("We couldn't spot any books in that photo.", 'warning');
        return;
      }
      router.push({ pathname: '/review', params: { data: JSON.stringify(result) } });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = String(e?.message || 'Something went wrong');
      if (msg.includes('ZERO_BOOKS')) toast.show("No book spines detected. Try better lighting.", 'warning');
      else if (msg.includes('TIMEOUT')) toast.show('AI took too long. Please try again.', 'error');
      else if (msg.includes('NETWORK')) toast.show('Cannot reach the server. Check your connection.', 'error');
      else toast.show(msg.replace(/^[A-Z_]+:\s*/, ''), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.show('Camera permission required.', 'warning'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    runScan(res.assets[0].uri);
  };

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    runScan(res.assets[0].uri);
  };

  const STEPS = ['Detecting spines', 'Reading titles', 'Matching catalog'];

  return (
    <View style={styles.root}>
      {/* Full-bleed hero image */}
      <View style={styles.heroFull}>
        <Image
          source={{ uri: theme.images.heroShelf }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={400}
        />
        {/* Gradient from top for safe area */}
        <LinearGradient
          colors={[theme.colors.surface, 'transparent']}
          style={[styles.topGradient, { height: insets.top + 60 }]}
        />
        {/* Gradient from bottom for buttons */}
        <LinearGradient
          colors={['transparent', 'rgba(253,251,247,0.97)', theme.colors.surface]}
          style={styles.bottomGradient}
        />

        {/* Header overlay */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.eyebrow}>New scan</Text>
          <Text style={styles.title}>Point at{'\n'}a shelf.</Text>
        </View>

        {/* Tip badge */}
        <View style={styles.tipBadge}>
          <Feather name="zap" size={13} color={theme.colors.onBrandPrimary} />
          <Text style={styles.tipText}>Best results face-on, evenly lit</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.subtitle}>
          Gemini AI reads every spine and builds your digital library in seconds.
        </Text>
        <Pressable
          testID="scan-camera-btn"
          onPress={takePhoto}
          disabled={processing}
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.88 }]}
        >
          <Feather name="camera" size={18} color={theme.colors.onBrandPrimary} />
          <Text style={styles.primaryBtnText}>Take a photo</Text>
        </Pressable>
        <Pressable
          testID="scan-upload-btn"
          onPress={pickPhoto}
          disabled={processing}
          style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
        >
          <Feather name="image" size={16} color={theme.colors.onSurface} />
          <Text style={styles.secondaryBtnText}>Choose from gallery</Text>
        </Pressable>
      </View>

      {/* Processing overlay */}
      {processing && (
        <View style={StyleSheet.absoluteFill} testID="scan-processing-overlay">
          <LinearGradient
            colors={['rgba(28,25,23,0.96)', 'rgba(41,27,23,0.98)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.processingContent}>
            <View style={styles.spinnerRing}>
              <ActivityIndicator size="large" color={theme.colors.onBrandPrimary} />
            </View>
            <Text style={styles.processingText}>{status}</Text>
            <View style={styles.stepIndicators}>
              {STEPS.map((s, i) => (
                <View key={s} style={styles.stepRow}>
                  <View style={[styles.stepDot, i <= step && styles.stepDotActive]}>
                    {i < step && <Feather name="check" size={10} color="#fff" />}
                  </View>
                  <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]}>{s}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.processingSub}>This can take 10–30 seconds</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  heroFull: {
    flex: 1,
    minHeight: SCREEN_H * 0.52,
    maxHeight: SCREEN_H * 0.62,
  },
  topGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 2,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '50%',
    zIndex: 2,
  },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingHorizontal: theme.spacing.xl,
    zIndex: 3,
  },
  eyebrow: {
    fontSize: 11, letterSpacing: 1.5,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase', fontWeight: '700',
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 44,
    color: theme.colors.onSurface,
    letterSpacing: -1,
    lineHeight: 50,
    marginTop: 4,
  },
  tipBadge: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    left: theme.spacing.xl,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  tipText: { color: theme.colors.onBrandPrimary, fontSize: 12, fontWeight: '600' },
  actions: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  subtitle: {
    fontSize: 13, color: theme.colors.mutedText, lineHeight: 19,
    marginBottom: theme.spacing.xs,
  },
  primaryBtn: {
    backgroundColor: theme.colors.brandPrimary,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: theme.spacing.sm,
    shadowColor: theme.colors.brandPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  secondaryBtn: {
    backgroundColor: theme.colors.surfaceSecondary,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  secondaryBtnText: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '600' },
  // Processing overlay
  processingContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
  },
  spinnerRing: {
    width: 72, height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  processingText: {
    color: '#fff',
    fontFamily: theme.fonts.display,
    fontSize: 26,
    textAlign: 'center',
  },
  stepIndicators: { gap: 10, alignSelf: 'stretch', paddingHorizontal: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: theme.colors.brandPrimary },
  stepLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  stepLabelActive: { color: '#fff', fontWeight: '600' },
  processingSub: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
});
