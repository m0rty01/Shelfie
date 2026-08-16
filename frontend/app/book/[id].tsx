import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { LibraryBook, deleteBook, getBook } from '@/src/api';
import { useToast } from '@/src/toast';

export default function BookDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [loading, setLoading] = useState(true);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      try {
        if (!id) return;
        const b = await getBook(String(id));
        setBook(b);
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      } catch (e: any) {
        toast.show(e?.message || 'Failed to load book', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, toast]);

  const onDelete = async () => {
    if (!book) return;
    try {
      await deleteBook(book.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      toast.show('Removed from your library', 'success');
      router.back();
    } catch (e: any) {
      toast.show(e?.message || 'Delete failed', 'error');
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.colors.brandPrimary} />
      </View>
    );
  }
  if (!book) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: theme.colors.mutedText }}>Book not found.</Text>
      </View>
    );
  }

  const hasImage = !!(book.cover_url || book.spine_b64);
  const imageUri = book.cover_url || (book.spine_b64 ? `data:image/jpeg;base64,${book.spine_b64}` : null);
  const confidencePct = Math.round((book.confidence || 0) * 100);
  const addedDate = new Date(book.confirmed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <Animated.View style={[styles.root, { opacity: fadeAnim }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

        {/* Full-bleed cover hero */}
        <View style={styles.heroWrap}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.heroPlaceholder]}>
              <Feather name="book" size={64} color={theme.colors.borderStrong} />
            </View>
          )}
          {/* Top gradient for nav buttons */}
          <LinearGradient
            colors={['rgba(28,25,23,0.55)', 'transparent']}
            style={[styles.heroTopGradient, { paddingTop: insets.top + 8 }]}
          >
            <View style={styles.topBar}>
              <Pressable testID="book-back-btn" onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                <Feather name="arrow-left" size={20} color="#fff" />
              </Pressable>
              <Pressable testID="book-delete-btn" onPress={onDelete} hitSlop={12} style={[styles.iconBtn, styles.iconBtnDelete]}>
                <Feather name="trash-2" size={17} color={theme.colors.error} />
              </Pressable>
            </View>
          </LinearGradient>
          {/* Bottom gradient into content */}
          {hasImage && (
            <LinearGradient
              colors={['transparent', theme.colors.surface]}
              style={styles.heroBottomGradient}
            />
          )}
        </View>

        {/* Content */}
        <View style={styles.body}>
          <Text style={styles.eyebrow}>In your library</Text>
          <Text style={styles.title} testID="book-title">{book.title}</Text>
          <Text style={styles.author}>{book.author}</Text>

          {/* Meta pills */}
          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Feather name="calendar" size={12} color={theme.colors.mutedText} />
              <Text style={styles.metaText}>{addedDate}</Text>
            </View>
            {confidencePct > 0 && (
              <View style={[styles.metaPill, { backgroundColor: confidencePct >= 80 ? '#E8F5E9' : '#FFF3E0' }]}>
                <Feather name="target" size={12} color={confidencePct >= 80 ? theme.colors.success : theme.colors.warning} />
                <Text style={[styles.metaText, { color: confidencePct >= 80 ? theme.colors.success : theme.colors.warning }]}>
                  {confidencePct}% match
                </Text>
              </View>
            )}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Spine image if separate from cover */}
          {book.spine_b64 && book.cover_url && (
            <View style={styles.spineBlock}>
              <Text style={styles.sectionLabel}>Original spine photo</Text>
              <Image
                source={{ uri: `data:image/jpeg;base64,${book.spine_b64}` }}
                style={styles.spineImg}
                contentFit="cover"
              />
            </View>
          )}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  heroWrap: {
    height: 420,
    backgroundColor: theme.colors.surfaceSecondary,
    position: 'relative',
  },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroTopGradient: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: theme.spacing.lg,
  },
  heroBottomGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 160,
  },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: theme.spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnDelete: { backgroundColor: 'rgba(255,255,255,0.9)' },
  body: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
  eyebrow: {
    fontSize: 11, letterSpacing: 1.5, color: theme.colors.brandPrimary,
    textTransform: 'uppercase', fontWeight: '700',
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 36,
    color: theme.colors.onSurface,
    marginTop: theme.spacing.xs,
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  author: {
    fontSize: 17, color: theme.colors.onSurfaceSecondary, marginTop: 6, fontWeight: '400',
  },
  metaRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.lg, flexWrap: 'wrap' },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: theme.colors.surfaceSecondary,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  metaText: { color: theme.colors.mutedText, fontSize: 12, fontWeight: '600' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.xl,
  },
  spineBlock: { marginBottom: theme.spacing.xl },
  sectionLabel: {
    fontSize: 11, letterSpacing: 1.2, color: theme.colors.mutedText,
    textTransform: 'uppercase', fontWeight: '700', marginBottom: theme.spacing.sm,
  },
  spineImg: {
    width: 90, height: 140, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
  },
});
