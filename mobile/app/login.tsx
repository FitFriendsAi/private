import { useState } from "react";
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [statusMsg, setStatusMsg] = useState("");

  async function handleSubmit() {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPass  = password.trim();
    if (!trimmedEmail) { Alert.alert("Missing email", "Please enter your email address."); return; }
    if (!trimmedPass)  { Alert.alert("Missing password", "Please enter your password."); return; }
    setSubmitting(true);
    setStatusMsg("Connecting…");
    try {
      if (tab === "login") {
        setStatusMsg("Signing in…");
        await login(trimmedEmail, trimmedPass);
      } else {
        const { apiRequest } = await import("@/lib/api");
        setStatusMsg("Creating account…");
        await apiRequest("POST", "/api/auth/register", {
          email: trimmedEmail,
          password: trimmedPass,
          name: name.trim() || trimmedEmail,
        });
        setStatusMsg("Signing in…");
        await login(trimmedEmail, trimmedPass);
      }
      setStatusMsg("Done!");
      router.replace("/(tabs)");
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message
        : (err as any)?.message ?? "Something went wrong";
      Alert.alert("Sign in failed", msg);
      setStatusMsg("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Scrollable content */}
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28, paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={{ marginBottom: 44 }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 36, color: "#ffffff", letterSpacing: -1 }}>
              FitCore
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 15, color: "#888888", marginTop: 4 }}>
              Your fitness. Tracked.
            </Text>
          </View>

          {/* Tab toggle */}
          <View style={{ flexDirection: "row", backgroundColor: "#1a1a1a", borderRadius: 14, padding: 4, marginBottom: 28 }}>
            {(["login", "register"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 10,
                  backgroundColor: tab === t ? "#ffffff" : "transparent",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: tab === t ? "#0a0a0a" : "#888888" }}>
                  {t === "login" ? "Sign In" : "Create Account"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Name field (register only) */}
          {tab === "register" && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#888888", marginBottom: 6 }}>NAME</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor="#555"
                autoCapitalize="words"
                returnKeyType="next"
                style={{
                  backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14,
                  color: "#ffffff", fontFamily: "Manrope", fontSize: 15,
                  borderWidth: 1, borderColor: "#2a2a2a",
                }}
              />
            </View>
          )}

          {/* Email */}
          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#888888", marginBottom: 6 }}>EMAIL</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              style={{
                backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14,
                color: "#ffffff", fontFamily: "Manrope", fontSize: 15,
                borderWidth: 1, borderColor: "#2a2a2a",
              }}
            />
          </View>

          {/* Password */}
          <View>
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#888888", marginBottom: 6 }}>PASSWORD</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#555"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              style={{
                backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14,
                color: "#ffffff", fontFamily: "Manrope", fontSize: 15,
                borderWidth: 1, borderColor: "#2a2a2a",
              }}
            />
          </View>
        </ScrollView>

        {/* Submit button — pinned above keyboard, never hidden */}
        <View style={{ paddingHorizontal: 28, paddingBottom: 16, paddingTop: 12, backgroundColor: "#0a0a0a" }}>
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={({ pressed }) => ({
              backgroundColor: "#ffffff",
              borderRadius: 14, paddingVertical: 16,
              alignItems: "center",
              opacity: pressed || submitting ? 0.7 : 1,
            })}
          >
            {submitting
              ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator color="#0a0a0a" />
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#0a0a0a" }}>
                    {statusMsg || "Please wait…"}
                  </Text>
                </View>
              : <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: "#0a0a0a" }}>
                  {tab === "login" ? "Sign In" : "Create Account"}
                </Text>
            }
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
