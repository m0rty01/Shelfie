import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/src/theme';
import { scanImage } from '@/src/api';
import { useToast } from '@/src/toast';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState('Detecting spines…');

  const runScan = async (uri: string) => {
    setProcessing(true);
    setStatus('Detecting spines…');
    try {
      setTimeout(() => setStatus('Reading titles…'), 2500);
      setTimeout(() => setStatus('Matching your catalog…'), 8000);
      const result = await scanImage(uri, 90000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.detected_count === 0) {
        toast.show("We couldn't spot any books in that photo.", 'warning');
        return;
      }
      router.push({
        pathname: '/review',
        params: { data: JSON.stringify(result) },
      });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = String(e?.message || 'Something went wrong');
      if (msg.includes('ZERO_BOOKS')) {
        toast.show("We couldn't spot any book spines in that photo. Try again with better light.", 'warning');
      } else if (msg.includes('TIMEOUT')) {
        toast.show('The AI took too long to respond. Please try again.', 'error');
      } else if (msg.includes('BAD_DATA')) {
        toast.show('Server sent an unreadable response. Please try again.', 'error');
      } else if (msg.includes('NETWORK')) {
        toast.show('Could not reach the server. Check your connection.', 'error');
      } else {
        toast.show(msg.replace(/^[A-Z_]+:\s*/, ''), 'error');
      }
    } finally {
      setProcessing(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.show('Camera permission is required to scan a shelf.', 'warning');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    runScan(res.assets[0].uri);
  };

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    runScan(res.assets[0].uri);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>New scan</Text>
        <Text style={styles.title}>Point at a shelf.</Text>
        <Text style={styles.subtitle}>
          Capture your bookshelf and Shelfie will identify the spines, read the titles, and match them to your catalog.
        </Text>
      </View>

      <View style={styles.heroWrap}>
        <Image
          source={{ uri: theme.images.heroShelf }}
          style={styles.hero}
          contentFit="cover"
          transition={300}
        />
        <View style={styles.heroOverlay} />
        <View style={styles.heroCaption}>
          <Feather name="book-open" size={16} color={theme.colors.onBrandPrimary} />
          <Text style={styles.heroCaptionText}>Best results: shelf face-on, evenly lit.</Text>
        </View>
      </View>

      <View style={[styles.actions, { paddingBottom: theme.spacing.xl }]}>
        <Pressable
          testID="scan-camera-btn"
          onPress={takePhoto}
          disabled={processing}
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
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
          <Feather name="upload" size={16} color={theme.colors.onSurface} />
          <Text style={styles.secondaryBtnText}>Upload from gallery</Text>
        </Pressable>
      </View>

      {processing && (
        <View style={styles.processingOverlay} testID="scan-processing-overlay">
          <ActivityIndicator size="large" color={theme.colors.onSurfaceInverse} />
          <Text style={styles.processingText}>{status}</Text>
          <Text style={styles.processingSub}>This can take 10–30 seconds.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 34,
    color: theme.colors.onSurface,
    marginTop: theme.spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: theme.spacing.sm,
    fontSize: 14,
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  heroWrap: {
    marginTop: theme.spacing.xl,
    marginHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    aspectRatio: 4 / 5,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  hero: { width: '100%', height: '100%' },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28,25,23,0.15)',
  },
  heroCaption: {
    position: 'absolute',
    bottom: theme.spacing.lg,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.brandPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  heroCaptionText: { color: theme.colors.onBrandPrimary, fontSize: 12, fontWeight: '600' },
  actions: {
    marginTop: 'auto',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  primaryBtn: {
    backgroundColor: theme.colors.brandPrimary,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  primaryBtnText: {
    color: theme.colors.onBrandPrimary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    backgroundColor: theme.colors.surfaceSecondary,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  secondaryBtnText: {
    color: theme.colors.onSurface,
    fontSize: 14,
    fontWeight: '600',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(41,37,36,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  processingText: {
    color: theme.colors.onSurfaceInverse,
    fontFamily: theme.fonts.display,
    fontSize: 24,
  },
  processingSub: {
    color: theme.colors.onSurfaceInverse,
    opacity: 0.7,
    fontSize: 13,
  },
});
