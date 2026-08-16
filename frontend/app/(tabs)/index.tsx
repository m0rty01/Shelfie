import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { getLibrary, LibraryBook } from '@/src/api';
import { useToast } from '@/src/toast';

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getLibrary();
      setBooks(data);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load library', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const renderItem = ({ item, index }: { item: LibraryBook; index: number }) => (
    <BookCard item={item} index={index} onPress={() => router.push(`/book/${item.id}`)} />
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header} testID="library-header">
        <View>
          <Text style={styles.eyebrow}>Your collection</Text>
          <Text style={styles.headerTitle}>Shelfie</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countText}>
            {books.length} {books.length === 1 ? 'book' : 'books'}
          </Text>
        </View>
      </View>

      {loading ? (
        <SkeletonGrid />
      ) : books.length === 0 ? (
        <EmptyState onScan={() => router.push('/scan')} />
      ) : (
        <FlatList
          testID="library-list"
          data={books}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: theme.spacing.lg }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.brandPrimary}
              colors={[theme.colors.brandPrimary]}
            />
          }
        />
      )}
    </View>
  );
}

function BookCard({ item, index, onPress }: { item: LibraryBook; index: number; onPress: () => void }) {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Pressable
        testID={`library-book-${item.id}`}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.coverWrap}>
          {item.cover_url ? (
            <Image source={{ uri: item.cover_url }} style={styles.cover} contentFit="cover" transition={300} />
          ) : item.spine_b64 ? (
            <Image source={{ uri: `data:image/jpeg;base64,${item.spine_b64}` }} style={styles.cover} contentFit="cover" />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <LinearGradient
                colors={[theme.colors.surfaceSecondary, theme.colors.surfaceTertiary]}
                style={StyleSheet.absoluteFill}
              />
              <Feather name="book" size={28} color={theme.colors.borderStrong} />
            </View>
          )}
          {/* Subtle bottom scrim for text legibility if cover exists */}
          {item.cover_url && (
            <LinearGradient
              colors={['transparent', 'rgba(28,25,23,0.3)']}
              style={styles.coverScrim}
            />
          )}
        </View>
        <Text numberOfLines={2} style={styles.cardTitle}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.cardAuthor}>{item.author}</Text>
      </Pressable>
    </Animated.View>
  );
}

function SkeletonGrid() {
  return (
    <View style={styles.grid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={[styles.skeletonCard, { opacity: 1 - i * 0.15 }]}>
            <View style={styles.skeletonCover} />
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, { width: '60%' }]} />
          </View>
          <View style={[styles.skeletonCard, { opacity: 1 - i * 0.15 }]}>
            <View style={styles.skeletonCover} />
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, { width: '60%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <View style={styles.emptyWrap} testID="library-empty">
      <View style={styles.emptyImgWrap}>
        <Image
          source={{ uri: theme.images.empty }}
          style={styles.emptyImg}
          contentFit="cover"
          transition={350}
        />
        <LinearGradient
          colors={['transparent', theme.colors.surface]}
          style={styles.emptyImgGradient}
        />
      </View>
      <Text style={styles.emptyTitle}>Your shelves are empty</Text>
      <Text style={styles.emptySubtitle}>
        Take a photo of any bookshelf and Shelfie will build your digital library in seconds.
      </Text>
      <Pressable
        testID="empty-scan-btn"
        onPress={onScan}
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.88 }]}
      >
        <Feather name="camera" size={16} color={theme.colors.onBrandPrimary} />
        <Text style={styles.primaryBtnText}>Scan a bookshelf</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 2,
  },
  headerTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 44,
    color: theme.colors.onSurface,
    letterSpacing: -1,
    lineHeight: 48,
  },
  countPill: {
    backgroundColor: theme.colors.surfaceSecondary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.mutedText,
    letterSpacing: 0.3,
  },
  grid: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: 120,
    gap: theme.spacing.xl,
  },
  card: { flex: 1 },
  cardPressed: { opacity: 0.85 },
  coverWrap: {
    aspectRatio: 2 / 3,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: '100%' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverScrim: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '40%',
  },
  cardTitle: {
    marginTop: theme.spacing.sm,
    fontFamily: theme.fonts.display,
    fontSize: 15,
    color: theme.colors.onSurface,
    lineHeight: 20,
  },
  cardAuthor: {
    marginTop: 2,
    fontSize: 11,
    color: theme.colors.mutedText,
    letterSpacing: 0.2,
  },
  // Skeleton
  skeletonRow: { flexDirection: 'row', gap: theme.spacing.lg, marginBottom: theme.spacing.xl },
  skeletonCard: { flex: 1 },
  skeletonCover: {
    aspectRatio: 2 / 3,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
  },
  skeletonLine: {
    marginTop: theme.spacing.sm,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.surfaceSecondary,
    width: '85%',
  },
  // Empty
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xl },
  emptyImgWrap: { width: 240, height: 240, borderRadius: theme.radius.lg, overflow: 'hidden', marginBottom: theme.spacing.lg },
  emptyImg: { width: '100%', height: '100%' },
  emptyImgGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%' },
  emptyTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 28,
    color: theme.colors.onSurface,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  emptySubtitle: {
    color: theme.colors.mutedText,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  primaryBtn: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.colors.brandPrimary,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    shadowColor: theme.colors.brandPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
});
