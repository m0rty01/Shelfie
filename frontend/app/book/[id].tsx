import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

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

  useEffect(() => {
    (async () => {
      try {
        if (!id) return;
        const b = await getBook(String(id));
        setBook(b);
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
      <View style={[styles.root, { paddingTop: insets.top + 24, alignItems: 'center' }]}>
        <ActivityIndicator color={theme.colors.brandPrimary} />
      </View>
    );
  }
  if (!book) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
        <Text style={{ textAlign: 'center', color: theme.colors.mutedText }}>Book not found.</Text>
      </View>
    );
  }

  const confidencePct = Math.round((book.confidence || 0) * 100);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          testID="book-back-btn"
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Pressable
          testID="book-delete-btn"
          onPress={onDelete}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Feather name="trash-2" size={18} color={theme.colors.error} />
        </Pressable>
      </View>

      <View style={styles.heroWrap}>
        {book.cover_url ? (
          <Image source={{ uri: book.cover_url }} style={styles.hero} contentFit="cover" />
        ) : book.spine_b64 ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${book.spine_b64}` }}
            style={styles.hero}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.hero, { alignItems: 'center', justifyContent: 'center' }]}>
            <Feather name="book" size={64} color={theme.colors.mutedText} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.eyebrow}>Book</Text>
        <Text style={styles.title} testID="book-title">{book.title}</Text>
        <Text style={styles.author}>{book.author}</Text>

        <View style={styles.metaRow}>
          <Feather name="check-circle" size={14} color={theme.colors.success} />
          <Text style={styles.metaText}>
            Added {new Date(book.confirmed_at).toLocaleDateString()} · Match {confidencePct}%
          </Text>
        </View>

        {book.spine_b64 && book.cover_url && (
          <View style={styles.spineBlock}>
            <Text style={styles.sectionLabel}>Original spine</Text>
            <Image
              source={{ uri: `data:image/jpeg;base64,${book.spine_b64}` }}
              style={styles.spineImg}
              contentFit="cover"
            />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  heroWrap: {
    marginHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    aspectRatio: 3 / 4,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  hero: { width: '100%', height: '100%' },
  body: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl },
  eyebrow: {
    fontSize: 11, letterSpacing: 1.5, color: theme.colors.brandPrimary,
    textTransform: 'uppercase', fontWeight: '700',
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 32,
    color: theme.colors.onSurface,
    marginTop: theme.spacing.xs,
    letterSpacing: -0.5,
  },
  author: { fontSize: 16, color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  metaRow: {
    marginTop: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: { color: theme.colors.mutedText, fontSize: 13 },
  spineBlock: {
    marginTop: theme.spacing.xl2,
  },
  sectionLabel: {
    fontSize: 11, letterSpacing: 1.2, color: theme.colors.mutedText,
    textTransform: 'uppercase', fontWeight: '700', marginBottom: theme.spacing.sm,
  },
  spineImg: {
    width: 90,
    height: 140,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
  },
});
