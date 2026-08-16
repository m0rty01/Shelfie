import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { View, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function ScanTabButton({ onPress, children }: any) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.scanBtnOuter}
      android_ripple={{ color: 'rgba(156,65,61,0.2)', borderless: true }}
    >
      <View style={styles.scanBtnInner}>
        <Feather name="camera" size={22} color={theme.colors.onBrandPrimary} />
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandPrimary,
        tabBarInactiveTintColor: theme.colors.mutedText,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 64 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom || 12,
          elevation: 8,
          shadowColor: '#1C1917',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Feather name="book-open" size={20} color={color} />
            </View>
          ),
          tabBarButtonTestID: 'tab-library',
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarButton: (props) => <ScanTabButton {...props} />,
          tabBarButtonTestID: 'tab-scan',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 36, height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: theme.colors.brandTertiary,
  },
  scanBtnOuter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },
  scanBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.brandPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
    borderWidth: 3,
    borderColor: theme.colors.surface,
  },
});
