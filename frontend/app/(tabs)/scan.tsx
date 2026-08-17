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
const HERO_H = Math.min(SCREEN_H * 0.55, 380);

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState('Detecting spines…');
  const [step, setStep] = useState(0);

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
      mediaTypes: 'images', quality: 0.85, allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    runScan(res.assets[0].uri);
  };

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', quality: 0.85, allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    runScan(res.assets[0].uri);
  };

  const STEPS = ['Detecting spines', 'Reading titles', 'Matching catalog'];

  return (
    <View style={styles.root}>

      {/* ── Hero image block ── fixed height, dark overlay, WHITE text on top */}
      <View style={[styles.hero, { height: HERO_H }]}>
        <Image
          source={{ uri: theme.images.heroShelf }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={400}
        />
        {/* Dark scrim so white text is always readable */}
        <View style={styles.heroScrim} />
        {/* Stronger gradient at top behind header text */}
        <LinearGradient
          colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.0)']}
          style={[styles.heroTopGradient, { paddingTop: insets.top + 16 }]}
        >
          <Text style={styles.eyebrow}>New scan</Text>
          <Text style={styles.title}>Point at{'\n'}a shelf.</Text>
        </LinearGradient>
        {/* Tip badge bottom-left */}
        <View style={styles.tipBadge}>
          <Feather name="zap" size={13} color="#fff" />
          <Text style={styles.tipText}>Best results face-on, evenly lit</Text>
        </View>
      </View>

      {/* ── Action area ── solid white background, always visible */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={styles.subtitle}>
          Gemini AI reads every spine and builds your library in seconds.
        </Text>
        <Pressable
          testID="scan-camera-btn"
          onPress={takePhoto}
          disabled={processing}
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.88 }]}
        >
          <Feather name="camera" size={18} color="#fff" />
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

      {/* ── Processing overlay ── covers everything ── */}
      {processing && (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} testID="scan-processing-overlay">
          <View style={styles.processingContent}>
            <View style={styles.spinnerRing}>
              <ActivityIndicator size="large" color="#fff" />
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

  // Hero
  hero: {
    width: '100%',
    backgroundColor: '#2A1F1C',  // fallback while image loads
    overflow: 'hidden',
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,14,12,0.30)',
  },
  heroTopGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.8,
    color: 'rgba(255,255,255,0.75)',   // WHITE on dark image
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 6,
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 44,
    color: '#FFFFFF',                   // WHITE on dark image
    letterSpacing: -1,
    lineHeight: 52,
  },
  tipBadge: {
    position: 'absolute',
    bottom: theme.spacing.lg,
    left: theme.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.brandPrimary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
  },
  tipText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Actions — SOLID white so buttons are always visible
  actions: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.md,
    justifyContent: 'flex-end',
  },
  subtitle: {
    fontSize: 13,
    color: theme.colors.mutedText,
    lineHeight: 20,
    marginBottom: 4,
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
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  secondaryBtn: {
    backgroundColor: theme.colors.surfaceSecondary,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryBtnText: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '600' },

  // Processing overlay
  overlay: {
    backgroundColor: 'rgba(20,12,10,0.93)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingContent: {
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
  },
  spinnerRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  processingText: {
    color: '#fff',
    fontFamily: theme.fonts.display,
    fontSize: 26,
    textAlign: 'center',
  },
  stepIndicators: { gap: 12, alignSelf: 'stretch', paddingHorizontal: 24 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: theme.colors.brandPrimary },
  stepLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 15 },
  stepLabelActive: { color: '#fff', fontWeight: '700' },
  processingSub: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4 },
});
