import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from './theme';

type ToastKind = 'info' | 'success' | 'error' | 'warning';
type Toast = { id: number; text: string; kind: ToastKind };
type Ctx = { show: (text: string, kind?: ToastKind) => void };

const ToastCtx = createContext<Ctx>({ show: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = idRef.current++;
    setItems((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <ToastStack items={items} />
    </ToastCtx.Provider>
  );
}

function ToastStack({ items }: { items: Toast[] }) {
  const insets = useSafeAreaInsets();
  if (items.length === 0) return null;
  return (
    <View pointerEvents="none" style={[styles.stack, { top: insets.top + 12 }]}>
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(-10)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [opacity, translate]);

  const bg =
    toast.kind === 'success'
      ? theme.colors.success
      : toast.kind === 'error'
        ? theme.colors.error
        : toast.kind === 'warning'
          ? theme.colors.warning
          : theme.colors.surfaceInverse;

  return (
    <Animated.View
      testID={`toast-${toast.kind}`}
      style={[styles.toast, { backgroundColor: bg, opacity, transform: [{ translateY: translate }] }]}
    >
      <Text style={styles.toastText}>{toast.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    maxWidth: '100%',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
