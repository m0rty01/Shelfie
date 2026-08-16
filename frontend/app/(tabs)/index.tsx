import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const renderItem = ({ item }: { item: LibraryBook }) => (
    <Pressable
      testID={`library-book-${item.id}`}
      onPress={() => router.push(`/book/${item.id}`)}
      style={styles.card}
    >
      <View style={styles.coverWrap}>
        {item.cover_url ? (
          <Image
            source={{ uri: item.cover_url }}
            style={styles.cover}
            contentFit="cover"
            transition={200}
          />
        ) : item.spine_b64 ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${item.spine_b64}` }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Feather name="book" size={22} color={theme.colors.mutedText} />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={styles.cardTitle}>
        {item.title}
      </Text>
      <Text numberOfLines={1} style={styles.cardAuthor}>
        {item.author}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header} testID="library-header">
        <Text style={styles.headerTitle}>Shelfie</Text>
        <Text style={styles.headerSubtitle}>
          {books.length} {books.length === 1 ? 'book' : 'books'} on your shelf
        </Text>
      </View>

      {loading ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptySubtitle}>Loading your library…</Text>
        </View>
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brandPrimary} />
          }
        />
      )}
    </View>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <View style={styles.emptyWrap} testID="library-empty">
      <Image
        source={{ uri: theme.images.empty }}
        style={styles.emptyImg}
        contentFit="cover"
        transition={250}
      />
      <Text style={styles.emptyTitle}>Your shelves are empty</Text>
      <Text style={styles.emptySubtitle}>
        Take a photo of a real bookshelf and Shelfie will build your digital library.
      </Text>
      <Pressable testID="empty-scan-btn" onPress={onScan} style={styles.primaryBtn}>
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
  },
  headerTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 42,
    color: theme.colors.onSurface,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: theme.colors.mutedText,
  },
  grid: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl2,
    gap: theme.spacing.xl,
  },
  card: {
    flex: 1,
    marginBottom: theme.spacing.xl,
  },
  coverWrap: {
    aspectRatio: 2 / 3,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: '100%' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardTitle: {
    marginTop: theme.spacing.sm,
    fontFamily: theme.fonts.display,
    fontSize: 16,
    color: theme.colors.onSurface,
    lineHeight: 20,
  },
  cardAuthor: {
    marginTop: 2,
    fontSize: 12,
    color: theme.colors.mutedText,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  emptyImg: {
    width: 220,
    height: 220,
    borderRadius: theme.radius.lg,
    marginBottom: theme.spacing.md,
  },
  emptyTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 26,
    color: theme.colors.onSurface,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: theme.colors.mutedText,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.brandPrimary,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  primaryBtnText: {
    color: theme.colors.onBrandPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
