import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { theme } from '@/src/theme';
import { CatalogItem, DetectedBook, ScanResponse, confirmBook, searchCatalog } from '@/src/api';
import { useToast } from '@/src/toast';

type ReviewItem = DetectedBook & { _confirmed?: boolean; _discarded?: boolean };

export default function ReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ data?: string }>();

  const parsed: ScanResponse | null = useMemo(() => {
    try {
      return params.data ? (JSON.parse(params.data) as ScanResponse) : null;
    } catch {
      return null;
    }
  }, [params.data]);

  const [items, setItems] = useState<ReviewItem[]>(parsed?.review || []);
  const [busy, setBusy] = useState(false);
  const [correctTarget, setCorrectTarget] = useState<ReviewItem | null>(null);

  const remaining = items.filter((i) => !i._confirmed && !i._discarded);
  const autoAdded = parsed?.auto_added_count || 0;

  const doConfirm = async (item: ReviewItem, match?: CatalogItem) => {
    setBusy(true);
    try {
      const chosen = match || item.best_match;
      if (!chosen) {
        toast.show('Nothing to confirm — try Correct or Discard.', 'warning');
        return;
      }
      await confirmBook({
        catalog_id: chosen.id,
        title: chosen.title,
        author: chosen.author,
        cover_url: chosen.cover_url || null,
        spine_b64: item.spine_b64,
        confidence: match ? 1.0 : item.confidence,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setItems((prev) =>
        prev.map((p) => (p.spine_id === item.spine_id ? { ...p, _confirmed: true } : p)),
      );
    } catch (e: any) {
      toast.show(e?.message || 'Could not add book', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDiscard = (item: ReviewItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems((prev) =>
      prev.map((p) => (p.spine_id === item.spine_id ? { ...p, _discarded: true } : p)),
    );
  };

  const goBackToLibrary = () => {
    router.replace('/');
  };

  if (!parsed) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.emptyText}>Nothing to review.</Text>
        <Pressable testID="review-close-btn" onPress={goBackToLibrary} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Back to library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="review-back-btn" onPress={goBackToLibrary} hitSlop={12} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Review</Text>
          <Text style={styles.title}>
            {remaining.length} to review
          </Text>
          {autoAdded > 0 && (
            <Text style={styles.subtitle}>
              {autoAdded} book{autoAdded === 1 ? '' : 's'} added automatically.
            </Text>
          )}
        </View>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyStateWrap} testID="review-empty">
          <Feather name="check-circle" size={40} color={theme.colors.success} />
          <Text style={styles.emptyStateTitle}>All good.</Text>
          <Text style={styles.emptyStateSub}>Every book was matched with high confidence.</Text>
          <Pressable testID="review-done-btn" onPress={goBackToLibrary} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>See my library</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="review-list"
          data={items}
          keyExtractor={(i) => i.spine_id}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: 120,
            gap: theme.spacing.md,
          }}
          renderItem={({ item }) => (
            <ReviewCard
              item={item}
              onConfirm={() => doConfirm(item)}
              onCorrect={() => setCorrectTarget(item)}
              onDiscard={() => doDiscard(item)}
            />
          )}
        />
      )}

      {remaining.length === 0 && items.length > 0 && (
        <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable testID="review-finish-btn" onPress={goBackToLibrary} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Done — go to library</Text>
          </Pressable>
        </View>
      )}

      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator color={theme.colors.brandPrimary} />
        </View>
      )}

      <CorrectSheet
        target={correctTarget}
        onClose={() => setCorrectTarget(null)}
        onPick={(item, match) => {
          setCorrectTarget(null);
          doConfirm(item, match);
        }}
      />
    </View>
  );
}

function ReviewCard({
  item,
  onConfirm,
  onCorrect,
  onDiscard,
}: {
  item: ReviewItem;
  onConfirm: () => void;
  onCorrect: () => void;
  onDiscard: () => void;
}) {
  const isUnreadable = item.status === 'unreadable';
  const badgeColor =
    item.status === 'high'
      ? theme.colors.success
      : item.status === 'unreadable'
        ? theme.colors.error
        : theme.colors.warning;

  return (
    <View
      testID={`review-card-${item.spine_id}`}
      style={[
        styles.card,
        item._confirmed && { opacity: 0.5 },
        item._discarded && { opacity: 0.4 },
      ]}
    >
      <View style={styles.cardRow}>
        <View style={styles.spineImgWrap}>
          {item.spine_b64 ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${item.spine_b64}` }}
              style={styles.spineImg}
              contentFit="cover"
            />
          ) : (
            <View style={styles.spineImgPlaceholder}>
              <Feather name="book" size={22} color={theme.colors.mutedText} />
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={[styles.badge, { backgroundColor: badgeColor }]}>
            <Text style={styles.badgeText}>
              {item.status === 'high'
                ? 'High confidence'
                : item.status === 'unreadable'
                  ? 'Unreadable spine'
                  : `Low match · ${Math.round((item.confidence || 0) * 100)}%`}
            </Text>
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.best_match?.title || item.ocr_title || 'Unknown title'}
          </Text>
          <Text style={styles.cardAuthor} numberOfLines={1}>
            {item.best_match?.author || item.ocr_author || 'Unknown author'}
          </Text>
          {isUnreadable && (
            <Text style={styles.reason}>
              The spine text was too blurry to read. Tap Correct to enter it manually.
            </Text>
          )}
          {!isUnreadable && item.ocr_title && item.best_match && item.ocr_title !== item.best_match.title && (
            <Text style={styles.ocrHint} numberOfLines={1}>
              AI read: “{item.ocr_title}”
            </Text>
          )}
        </View>
      </View>

      {item._confirmed ? (
        <View style={[styles.statusRow, { backgroundColor: theme.colors.success }]}>
          <Feather name="check" size={14} color="#fff" />
          <Text style={styles.statusRowText}>Added to library</Text>
        </View>
      ) : item._discarded ? (
        <View style={[styles.statusRow, { backgroundColor: theme.colors.surfaceTertiary }]}>
          <Text style={[styles.statusRowText, { color: theme.colors.onSurface }]}>Discarded</Text>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          {!isUnreadable && item.best_match && (
            <Pressable
              testID={`confirm-btn-${item.spine_id}`}
              onPress={onConfirm}
              style={[styles.actionBtn, { backgroundColor: theme.colors.brandPrimary }]}
            >
              <Feather name="check" size={14} color={theme.colors.onBrandPrimary} />
              <Text style={[styles.actionText, { color: theme.colors.onBrandPrimary }]}>Confirm</Text>
            </Pressable>
          )}
          <Pressable
            testID={`correct-btn-${item.spine_id}`}
            onPress={onCorrect}
            style={[styles.actionBtn, { backgroundColor: theme.colors.surfaceTertiary }]}
          >
            <Feather name="edit-2" size={14} color={theme.colors.onSurface} />
            <Text style={[styles.actionText, { color: theme.colors.onSurface }]}>Correct</Text>
          </Pressable>
          <Pressable
            testID={`discard-btn-${item.spine_id}`}
            onPress={onDiscard}
            style={[styles.actionBtn, { backgroundColor: theme.colors.surfaceSecondary }]}
          >
            <Feather name="x" size={14} color={theme.colors.error} />
            <Text style={[styles.actionText, { color: theme.colors.error }]}>Discard</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function CorrectSheet({
  target,
  onClose,
  onPick,
}: {
  target: ReviewItem | null;
  onClose: () => void;
  onPick: (item: ReviewItem, match: CatalogItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!target) {
      setQ('');
      setResults([]);
      return;
    }
    // preload from OCR
    const seed = target.ocr_title || '';
    setQ(seed);
  }, [target]);

  React.useEffect(() => {
    if (!target) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchCatalog(q);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, target]);

  if (!target) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Correct this book</Text>
          <Text style={styles.sheetSub}>Search your catalog and pick the right title.</Text>
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color={theme.colors.mutedText} />
            <TextInput
              testID="correct-search-input"
              value={q}
              onChangeText={setQ}
              placeholder="Title or author"
              placeholderTextColor={theme.colors.mutedText}
              style={styles.searchInput}
              autoFocus
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 380 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          >
            {searching ? (
              <ActivityIndicator style={{ marginTop: 20 }} color={theme.colors.brandPrimary} />
            ) : results.length === 0 ? (
              <Text style={styles.noResults}>No matches in your catalog.</Text>
            ) : (
              results.map((r) => (
                <Pressable
                  testID={`catalog-result-${r.id}`}
                  key={r.id}
                  onPress={() => onPick(target, r)}
                  style={styles.resultRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle} numberOfLines={1}>{r.title}</Text>
                    <Text style={styles.resultAuthor} numberOfLines={1}>
                      {r.author}{r.edition ? ` · ${r.edition}` : ''}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.colors.mutedText} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  backBtn: {
    marginTop: 6,
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 30,
    color: theme.colors.onSurface,
  },
  subtitle: { color: theme.colors.mutedText, fontSize: 13, marginTop: 2 },
  emptyText: { textAlign: 'center', color: theme.colors.mutedText, marginTop: 48 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  cardRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  spineImgWrap: {
    width: 60,
    height: 90,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceTertiary,
  },
  spineImg: { width: '100%', height: '100%' },
  spineImgPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    marginBottom: theme.spacing.xs,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  cardTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 18,
    color: theme.colors.onSurface,
    lineHeight: 22,
  },
  cardAuthor: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  reason: { color: theme.colors.error, fontSize: 12, marginTop: 6 },
  ocrHint: { color: theme.colors.mutedText, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  actionsRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    flex: 1,
    justifyContent: 'center',
  },
  actionText: { fontSize: 13, fontWeight: '600' },
  statusRow: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
  },
  statusRowText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  emptyStateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  emptyStateTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 26,
    color: theme.colors.onSurface,
  },
  emptyStateSub: { color: theme.colors.mutedText, textAlign: 'center' },
  primaryBtn: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.brandPrimary,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    alignSelf: 'center',
  },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '700' },
  stickyBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  busyOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(28,25,23,0.4)',
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetHandle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    alignSelf: 'center', marginBottom: theme.spacing.md,
  },
  sheetTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 22,
    color: theme.colors.onSurface,
  },
  sheetSub: { color: theme.colors.mutedText, marginTop: 2, marginBottom: theme.spacing.md, fontSize: 13 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    color: theme.colors.onSurface,
    fontSize: 15,
  },
  noResults: { textAlign: 'center', color: theme.colors.mutedText, paddingVertical: 24 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultTitle: {
    fontSize: 15,
    color: theme.colors.onSurface,
    fontWeight: '600',
  },
  resultAuthor: { color: theme.colors.mutedText, fontSize: 12, marginTop: 2 },
});
