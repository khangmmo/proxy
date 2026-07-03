import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Clipboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "localhost";
const API_BASE = `https://${DOMAIN}/api/proxy`;
const TIMEOUT_MS = 10000;
const KEY_STORAGE = "proxy_rotator_key";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "connected"; proxy: string }
  | { kind: "error"; message: string }
  | { kind: "rotating" };

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [proxy, setProxy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isConnected = status.kind === "connected";
  const isLoading = status.kind === "checking" || status.kind === "rotating";

  useEffect(() => {
    AsyncStorage.getItem(KEY_STORAGE).then((saved) => {
      if (saved) setKey(saved);
    });
  }, []);

  const showToast = useCallback(
    (message: string, ok: boolean) => {
      setToast({ message, ok });
      Animated.sequence([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.delay(1800),
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start(() => setToast(null));
    },
    [toastOpacity],
  );

  const animateRotate = useCallback(() => {
    rotateAnim.setValue(0);
    Animated.timing(rotateAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [rotateAnim]);

  const pulseConnected = useCallback(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 1.06,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pulseAnim]);

  const checkKey = useCallback(async () => {
    if (!key.trim()) {
      showToast("Vui lòng nhập key!", false);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStatus({ kind: "checking" });
    setProxy(null);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/check_key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = (await res.json()) as {
        valid: boolean;
        proxy?: string;
        message?: string;
      };
      if (data.valid && data.proxy) {
        setProxy(data.proxy);
        setStatus({ kind: "connected", proxy: data.proxy });
        await AsyncStorage.setItem(KEY_STORAGE, key.trim());
        showToast("Key hợp lệ!", true);
        pulseConnected();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus({ kind: "error", message: data.message ?? "Key không hợp lệ!" });
        showToast("Key không hợp lệ!", false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "Hết thời gian kết nối!"
          : "Lỗi kết nối server!";
      setStatus({ kind: "error", message: msg });
      showToast(msg, false);
      console.error("[checkKey]", err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [key, showToast, pulseConnected]);

  const rotateProxy = useCallback(async () => {
    if (!isConnected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    animateRotate();
    setStatus({ kind: "rotating" });
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = (await res.json()) as {
        success: boolean;
        new_proxy?: string;
        message?: string;
      };
      if (data.success && data.new_proxy) {
        setProxy(data.new_proxy);
        setStatus({ kind: "connected", proxy: data.new_proxy });
        showToast("Xoay proxy thành công!", true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus({ kind: "connected", proxy: proxy ?? "" });
        showToast(`Lỗi: ${data.message ?? "Không xoay được!"}`, false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "Hết thời gian kết nối!"
          : "Lỗi kết nối server!";
      setStatus({ kind: "connected", proxy: proxy ?? "" });
      showToast(msg, false);
      console.error("[rotateProxy]", err);
    }
  }, [isConnected, key, proxy, showToast, animateRotate]);

  const copyProxy = useCallback(() => {
    if (!proxy) return;
    Clipboard.setString(proxy);
    showToast("Đã sao chép proxy!", true);
    Haptics.selectionAsync();
  }, [proxy, showToast]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const statusColor =
    status.kind === "connected"
      ? "#22c55e"
      : status.kind === "error"
        ? colors.primary
        : colors.mutedForeground;

  const statusText =
    status.kind === "idle"
      ? "Chưa kết nối"
      : status.kind === "checking"
        ? "Đang kiểm tra key..."
        : status.kind === "connected"
          ? "Kết nối thành công!"
          : status.kind === "rotating"
            ? "Đang xoay proxy..."
            : status.message;

  const statusDot =
    status.kind === "connected" ? "●" : status.kind === "error" ? "●" : "●";

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Toast */}
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            {
              opacity: toastOpacity,
              backgroundColor: toast.ok ? "#22c55e" : colors.primary,
              top: insets.top + webTop + 16,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + webTop + 24,
            paddingBottom: insets.bottom + webBottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.appTitle, { color: colors.primary }]}>
              Proxy Rotator
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.brandSmall, { color: colors.mutedForeground }]}>
              ADMIN KHANG DEV
            </Text>
          </View>
        </View>

        {/* Key input */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.input }]}
            placeholder="Nhập key của bạn"
            placeholderTextColor={colors.mutedForeground}
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={checkKey}
            editable={!isLoading}
          />

          {/* Action button */}
          <TouchableOpacity
            style={[
              styles.btnPrimary,
              { backgroundColor: colors.primary },
              isLoading && styles.btnDisabled,
            ]}
            onPress={checkKey}
            disabled={isLoading}
            activeOpacity={0.75}
          >
            {status.kind === "checking" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Kiem tra key</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Status */}
        <View
          style={[
            styles.statusBar,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.statusDot, { color: statusColor }]}>{statusDot}</Text>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
        </View>

        {/* Proxy display */}
        <View style={[styles.proxyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.proxyLabel, { color: colors.mutedForeground }]}>
            Proxy:
          </Text>
          {proxy ? (
            <TouchableOpacity onPress={copyProxy} activeOpacity={0.7}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Text style={[styles.proxyValue, { color: "#22c55e" }]}>
                  {proxy}
                </Text>
                <Text style={[styles.proxyHint, { color: colors.mutedForeground }]}>
                  Nhan de sao chep
                </Text>
              </Animated.View>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.proxyEmpty, { color: colors.mutedForeground }]}>
              Chua co proxy
            </Text>
          )}
        </View>

        {/* Rotate button */}
        <Pressable
          onPress={rotateProxy}
          disabled={!isConnected || status.kind === "rotating"}
          style={({ pressed }) => [
            styles.rotateBtn,
            {
              backgroundColor:
                isConnected ? colors.secondary : colors.muted,
              opacity: isConnected ? (pressed ? 0.8 : 1) : 0.4,
            },
          ]}
        >
          <Animated.View
            style={{
              transform: [{ rotate: status.kind === "rotating" ? spin : "0deg" }],
            }}
          >
            <Text style={styles.rotateBtnIcon}>↻</Text>
          </Animated.View>
          {status.kind === "rotating" ? (
            <ActivityIndicator color="#fff" size="small" style={{ marginLeft: 8 }} />
          ) : (
            <Text style={styles.rotateBtnText}>XOAY PROXY</Text>
          )}
        </Pressable>

        {/* Footer */}
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          ADMIN KHANG DEV © 2026
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    zIndex: 999,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  toastText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  appTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  brandSmall: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  serverSmall: {
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontWeight: "500",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
  },
  btnPrimary: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  btnSecondary: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    gap: 8,
  },
  statusDot: {
    fontSize: 12,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
  },
  proxyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    minHeight: 80,
    justifyContent: "center",
  },
  proxyLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  proxyValue: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    letterSpacing: 0.3,
  },
  proxyHint: {
    fontSize: 11,
    marginTop: 6,
  },
  proxyEmpty: {
    fontSize: 14,
    fontStyle: "italic",
  },
  rotateBtn: {
    borderRadius: 14,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 32,
  },
  rotateBtnIcon: {
    fontSize: 22,
    color: "#fff",
    fontWeight: "700",
  },
  rotateBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 2,
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
});
