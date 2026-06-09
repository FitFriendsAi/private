import { useState, useCallback, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, Alert, TextInput,
  ActivityIndicator, Platform, Modal, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useTheme, PALETTES } from "@/hooks/use-theme";
import { useHealth } from "@/hooks/use-health";
import { apiRequest } from "@/lib/api";
import { lbsToGrams, gramsToLbs, todayStr } from "@/lib/utils";
import {
  User, Scale, Activity, Heart, Check, LogOut,
  ChevronDown, X, Palette as PaletteIcon, RefreshCw,
} from "lucide-react-native";

// ── Height helpers ─────────────────────────────────────────────────────────
function cmToFtIn(cm: number | null | undefined): { ft: string; inch: string } {
  if (!cm) return { ft: "", inch: "" };
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn % 12);
  return { ft: String(ft), inch: String(inch) };
}
function ftInToCm(ft: string, inch: string): number | null {
  const f = parseFloat(ft);
  const i = parseFloat(inch);
  if (isNaN(f) && isNaN(i)) return null;
  return Math.round(((isNaN(f) ? 0 : f) * 12 + (isNaN(i) ? 0 : i)) * 2.54);
}

// ── Card header — inline icon, no box background ───────────────────────────
function CardHeader({
  icon: Icon, label, iconColor, text,
}: { icon: any; label: string; iconColor: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <Icon size={15} color={iconColor} />
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: text }}>{label}</Text>
    </View>
  );
}

// ── Options modal (used for dropdowns) ─────────────────────────────────────
function OptionsModal({
  visible, title, options, value, onSelect, onClose, bg, card, border, text, muted, accent, accentText,
}: {
  visible: boolean; title: string;
  options: { label: string; value: string }[];
  value: string; onSelect: (v: string) => void; onClose: () => void;
  bg: string; card: string; border: string; text: string; muted: string; accent: string; accentText: string;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" transparent={false}>
      <View style={{ flex: 1, backgroundColor: bg }}>
        <View style={{
          padding: 16, flexDirection: "row", justifyContent: "space-between",
          alignItems: "center", borderBottomWidth: 1, borderBottomColor: border,
        }}>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>{title}</Text>
          <Pressable onPress={onClose}><X size={22} color={text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {options.map(opt => (
            <Pressable
              key={opt.value}
              onPress={() => { onSelect(opt.value); onClose(); }}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                backgroundColor: value === opt.value ? `${accent}18` : card,
                borderRadius: 14, padding: 16,
                borderWidth: 1, borderColor: value === opt.value ? `${accent}55` : border,
                marginBottom: 8, opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{opt.label}</Text>
              {value === opt.value && <Check size={16} color={accent} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Select pill (shows current value + chevron) ────────────────────────────
function SelectPill({
  label, value, onPress, card, border, text, muted,
}: { label: string; value: string; onPress: () => void; card: string; border: string; text: string; muted: string }) {
  return (
    <View>
      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 6 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          backgroundColor: "#111111", borderRadius: 12, padding: 12,
          borderWidth: 1, borderColor: border, opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>{value}</Text>
        <ChevronDown size={14} color={muted} />
      </Pressable>
    </View>
  );
}

// ── Inline text input field ─────────────────────────────────────────────────
function InputField({
  label, value, onChangeText, placeholder, keyboardType, border, text, muted,
}: {
  label?: string; value: string; onChangeText: (v: string) => void;
  placeholder: string; keyboardType?: any;
  border: string; text: string; muted: string;
}) {
  return (
    <View>
      {label && (
        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 6 }}>{label}</Text>
      )}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={muted}
        keyboardType={keyboardType ?? "default"}
        style={{
          backgroundColor: "#111111", borderRadius: 12, padding: 12,
          borderWidth: 1, borderColor: border,
          fontFamily: "Manrope-SemiBold", fontSize: 13, color: text,
        }}
      />
    </View>
  );
}

const SEX_OPTIONS = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Other", value: "other" },
];
const ACTIVITY_OPTIONS = [
  { label: "Sedentary (little/no exercise)", value: "sedentary" },
  { label: "Light (1–3x/week)", value: "light" },
  { label: "Moderate (3–4x/week)", value: "moderate" },
  { label: "Active (5–6x/week)", value: "active" },
  { label: "Very Active (daily intense)", value: "veryActive" },
];
const WEIGHT_UNIT_OPTIONS = [
  { label: "Pounds (lbs)", value: "lbs" },
  { label: "Kilograms (kg)", value: "kg" },
];

function activityLabel(v: string) {
  return ACTIVITY_OPTIONS.find(o => o.value === v)?.label ?? v;
}
function weightUnitLabel(v: string) {
  return WEIGHT_UNIT_OPTIONS.find(o => o.value === v)?.label ?? v;
}
function sexLabel(v: string) {
  return SEX_OPTIONS.find(o => o.value === v)?.label ?? v;
}

// Accent colour display order for the swatches
const SWATCH_ORDER = ["white", "pink", "blue", "purple", "peach", "dark"];


// ── Main ──────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { palette, paletteId, setTheme } = useTheme();
  const { card, cardBorder: border, text, muted, accent, accentText, bg } = palette;
  const qc = useQueryClient();

  // ── Profile state ──
  const { data: profile } = useQuery<any>({
    queryKey: ["/api/profile"],
    queryFn: () => apiRequest("GET", "/api/profile"),
  });

  const { data: measurements = [] } = useQuery<any[]>({
    queryKey: ["/api/measurements"],
    queryFn: () => apiRequest("GET", "/api/measurements"),
  });
  const lastMeasurement = measurements[0] ?? null;

  const [ftVal,        setFtVal]        = useState("");
  const [inVal,        setInVal]        = useState("");
  const [birthDate,    setBirthDate]    = useState("");
  const [sex,          setSex]          = useState("male");
  const [activityLevel, setActivityLevel] = useState("moderate");
  const [weightUnit,   setWeightUnit]   = useState("lbs");

  // Populate form when profile loads
  useEffect(() => {
    if (!profile) return;
    const { ft, inch } = cmToFtIn(profile.heightCm);
    setFtVal(ft);
    setInVal(inch);
    setBirthDate(profile.birthDate ?? "");
    setSex(profile.sex ?? "male");
    setActivityLevel(profile.activityLevel ?? "moderate");
    setWeightUnit(profile.weightUnitPreference ?? "lbs");
  }, [profile]);

  // ── Save profile ──
  const saveProfile = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/profile", {
      heightCm: ftInToCm(ftVal, inVal),
      birthDate: birthDate || null,
      sex,
      activityLevel,
      weightUnitPreference: weightUnit,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/profile"] });
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
      Alert.alert("Saved", "Profile updated.");
    },
    onError: () => Alert.alert("Error", "Could not save profile."),
  });

  // ── Apple Health ──
  const health = useHealth();
  const [hkSyncing, setHkSyncing] = useState(false);

  const connectHealth = useCallback(() => {
    if (!health.available) {
      Alert.alert("Not available", "Apple Health is only available on iOS devices.");
      return;
    }
    health.authorize();
  }, [health]);

  const syncWeightFromHealth = useCallback(async () => {
    if (!health.available) { connectHealth(); return; }
    setHkSyncing(true);
    health.syncWeightFromHealth(
      async (date, weightKg) => {
        await apiRequest("POST", "/api/measurements", {
          date,
          weightGrams: Math.round(weightKg * 1000),
        });
      },
      (count) => {
        qc.invalidateQueries({ queryKey: ["/api/measurements"] });
        setHkSyncing(false);
        Alert.alert("Synced", count > 0 ? `Imported ${count} weight reading${count !== 1 ? "s" : ""} from Apple Health.` : "No new weight data found.");
      },
      (msg) => {
        setHkSyncing(false);
        Alert.alert("Sync failed", msg);
      },
    );
  }, [health, connectHealth, qc]);

  // ── Log weight ──
  const [weightInput, setWeightInput] = useState("");
  const logWeight = useMutation({
    mutationFn: () => apiRequest("POST", "/api/measurements", {
      date: todayStr(),
      weightGrams: lbsToGrams(parseFloat(weightInput)),
    }),
    onSuccess: () => {
      const kg = lbsToGrams(parseFloat(weightInput)) / 1000;
      health.writeWeight(kg);
      setWeightInput("");
      qc.invalidateQueries({ queryKey: ["/api/measurements"] });
      Alert.alert("Logged", "Weight saved!");
    },
    onError: () => Alert.alert("Error", "Could not log weight."),
  });

  // ── Picker modal state ──
  const [openPicker, setOpenPicker] = useState<
    "sex" | "activity" | "weightUnit" | null
  >(null);

  const pickerProps = {
    bg, card, border, text, muted, accent, accentText,
    onClose: () => setOpenPicker(null),
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Header ── */}
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 28, color: text }}>Settings</Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginTop: 2 }}>
              Manage your profile and preferences
            </Text>
          </View>

          {/* ── Account ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 14 }}>
            <CardHeader icon={User} label="Account" iconColor={muted} text={text} />
            {[
              { label: "Name",  value: user?.name  ?? "—" },
              { label: "Email", value: user?.email ?? "—" },
            ].map((row, i, arr) => (
              <View
                key={row.label}
                style={{
                  flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                  paddingVertical: 10,
                  borderTopWidth: 1, borderTopColor: border,
                }}
              >
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>{row.label}</Text>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>{row.value}</Text>
              </View>
            ))}
            {/* Sign out */}
            <Pressable
              onPress={() => Alert.alert("Sign out", "Are you sure?", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out", style: "destructive", onPress: logout },
              ])}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                marginTop: 12, paddingVertical: 10, borderRadius: 12,
                backgroundColor: "rgba(239,68,68,0.1)", opacity: pressed ? 0.7 : 1,
              })}
            >
              <LogOut size={15} color="#ef4444" />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#ef4444" }}>Sign Out</Text>
            </Pressable>
          </View>

          {/* ── Accent Colour ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 14 }}>
            <CardHeader icon={PaletteIcon} label="Accent Colour" iconColor={muted} text={text} />
            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginBottom: 14 }}>
              Personalise the app accent colour. Changes apply instantly.
            </Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              {SWATCH_ORDER.map(id => {
                const p = PALETTES.find(p => p.id === id);
                if (!p) return null;
                const selected = paletteId === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setTheme(id)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <View style={{
                      width: 44, height: 44, borderRadius: 22,
                      backgroundColor: p.accent,
                      borderWidth: selected ? 2.5 : 1.5,
                      borderColor: selected ? "#ffffff" : "rgba(255,255,255,0.15)",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      {selected && <Check size={18} color={p.accentText} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginTop: 12 }}>
              Current:{" "}
              <Text style={{ color: text }}>
                {PALETTES.find(p => p.id === paletteId)?.label ?? "White"}
              </Text>
            </Text>
          </View>

          {/* ── Log Today's Weight ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 14 }}>
            <CardHeader icon={Scale} label="Log Today's Weight" iconColor={muted} text={text} />

            {/* Last recorded subtitle */}
            {lastMeasurement && (
              <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: -8, marginBottom: 14 }}>
                Last recorded:{" "}
                <Text style={{ fontFamily: "Manrope-Bold", color: text }}>
                  {gramsToLbs(lastMeasurement.weightGrams)} lbs
                </Text>
                {" "}on{" "}
                <Text style={{ fontFamily: "Manrope-Bold", color: text }}>
                  {new Date(lastMeasurement.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Text>
              </Text>
            )}

            {/* Input + button row */}
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <TextInput
                value={weightInput}
                onChangeText={setWeightInput}
                placeholder="Weight in lbs"
                placeholderTextColor={muted}
                keyboardType="decimal-pad"
                style={{
                  flex: 1, backgroundColor: "#111111", borderRadius: 12, padding: 13,
                  borderWidth: 1, borderColor: border,
                  fontFamily: "Manrope-SemiBold", fontSize: 14, color: text,
                }}
              />
              <Pressable
                onPress={() => {
                  const v = parseFloat(weightInput);
                  if (isNaN(v) || v <= 0) { Alert.alert("Enter a valid weight"); return; }
                  logWeight.mutate();
                }}
                disabled={logWeight.isPending}
                style={({ pressed }) => ({
                  backgroundColor: "#3a3a3a", borderRadius: 12,
                  paddingHorizontal: 18, paddingVertical: 13,
                  opacity: pressed || logWeight.isPending ? 0.7 : 1,
                })}
              >
                {logWeight.isPending
                  ? <ActivityIndicator size="small" color={text} />
                  : <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>Log Weight</Text>
                }
              </Pressable>
            </View>

            {/* Last entry row */}
            {lastMeasurement && (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: border }}>
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                  {new Date(lastMeasurement.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </Text>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: text }}>
                  {gramsToLbs(lastMeasurement.weightGrams)} lbs
                </Text>
              </View>
            )}
          </View>

          {/* ── Body Profile ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 14 }}>
            <CardHeader icon={Activity} label="Body Profile" iconColor="#c8e84c" text={text} />

            {/* Height — full-width row with ft | in side by side */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 8 }}>
                Height
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {/* Feet */}
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={ftVal}
                      onChangeText={t => setFtVal(t.replace(/[^0-9]/g, ""))}
                      placeholder="0"
                      placeholderTextColor={muted}
                      keyboardType="numeric"
                      maxLength={1}
                      style={{
                        backgroundColor: "#111111", borderRadius: 12,
                        paddingVertical: 13, paddingHorizontal: 12,
                        textAlign: "center",
                        borderWidth: 1, borderColor: border,
                        fontFamily: "Manrope-Bold", fontSize: 18, color: text,
                      }}
                    />
                  </View>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 15, color: muted }}>ft</Text>
                </View>
                {/* Inches */}
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={inVal}
                      onChangeText={t => setInVal(t.replace(/[^0-9]/g, ""))}
                      placeholder="0"
                      placeholderTextColor={muted}
                      keyboardType="numeric"
                      maxLength={2}
                      style={{
                        backgroundColor: "#111111", borderRadius: 12,
                        paddingVertical: 13, paddingHorizontal: 12,
                        textAlign: "center",
                        borderWidth: 1, borderColor: border,
                        fontFamily: "Manrope-Bold", fontSize: 18, color: text,
                      }}
                    />
                  </View>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 15, color: muted }}>in</Text>
                </View>
              </View>
            </View>

            {/* Date of Birth — full-width row */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 8 }}>
                Date of Birth
              </Text>
              {Platform.OS === "web" ? (
                /* Wrap in View (no overflow:hidden) so the input is flex-constrained
                   without clipping the browser's native date-picker popup */
                <View>
                  {/* @ts-ignore */}
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e: any) => setBirthDate(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%", boxSizing: "border-box",
                      backgroundColor: "#111111",
                      border: `1px solid ${border}`,
                      borderRadius: "12px",
                      padding: "13px 12px",
                      color: "#f4f4f4",
                      fontFamily: "Manrope-SemiBold", fontSize: "14px",
                      outline: "none",
                      colorScheme: "dark",
                    }}
                  />
                </View>
              ) : (
                <TextInput
                  value={birthDate}
                  onChangeText={setBirthDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={muted}
                  keyboardType="numeric"
                  maxLength={10}
                  style={{
                    backgroundColor: "#111111", borderRadius: 12,
                    paddingVertical: 13, paddingHorizontal: 12,
                    borderWidth: 1, borderColor: border,
                    fontFamily: "Manrope-SemiBold", fontSize: 14, color: text,
                  }}
                />
              )}
            </View>

            {/* Sex + Activity Level row */}
            <View style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <SelectPill
                  label="Biological Sex"
                  value={sexLabel(sex)}
                  onPress={() => setOpenPicker("sex")}
                  card={card} border={border} text={text} muted={muted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SelectPill
                  label="Activity Level"
                  value={activityLabel(activityLevel).split(" (")[0]}
                  onPress={() => setOpenPicker("activity")}
                  card={card} border={border} text={text} muted={muted}
                />
              </View>
            </View>

            {/* Weight Units row */}
            <View style={{ marginBottom: 18 }}>
              <SelectPill
                label="Weight Units"
                value={weightUnitLabel(weightUnit)}
                onPress={() => setOpenPicker("weightUnit")}
                card={card} border={border} text={text} muted={muted}
              />
            </View>

            {/* Save button */}
            <Pressable
              onPress={() => saveProfile.mutate()}
              disabled={saveProfile.isPending}
              style={({ pressed }) => ({
                backgroundColor: "#c8e84c", borderRadius: 14,
                paddingVertical: 13, alignItems: "center",
                opacity: pressed || saveProfile.isPending ? 0.75 : 1,
              })}
            >
              {saveProfile.isPending
                ? <ActivityIndicator size="small" color="#0a0a0a" />
                : <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#0a0a0a" }}>Save Profile</Text>
              }
            </Pressable>
            <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, textAlign: "center", marginTop: 10 }}>
              Saving will recalculate your daily calorie and macro targets.
            </Text>
          </View>

          {/* ── Apple Health ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 8 }}>
            {/* Header row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: health.authorized ? 14 : 0 }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: health.authorized ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
                alignItems: "center", justifyContent: "center",
              }}>
                <Heart size={17} color={health.authorized ? "#ef4444" : muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>Apple Health</Text>
                <Text style={{ fontFamily: "Manrope", fontSize: 11, color: health.authorized ? "#22c55e" : muted }}>
                  {health.authorized ? "Connected" : health.available ? "Tap to connect" : "iOS only"}
                </Text>
              </View>
              {!health.authorized && (
                <Pressable
                  onPress={connectHealth}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 6,
                    backgroundColor: "#ef4444", borderRadius: 12,
                    paddingHorizontal: 14, paddingVertical: 8, opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Heart size={13} color="#fff" />
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#fff" }}>Connect</Text>
                </Pressable>
              )}
            </View>

            {/* Sync details — only when connected */}
            {health.authorized && (
              <>
                {/* What we read */}
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.6, marginBottom: 8 }}>READS FROM HEALTH</Text>
                <View style={{ gap: 6, marginBottom: 14 }}>
                  {[
                    { label: "Steps today",      value: health.todaySteps != null ? health.todaySteps.toLocaleString() : "—" },
                    { label: "Active calories",   value: health.todayActiveCalories != null ? `${health.todayActiveCalories} kcal` : "—" },
                  ].map(row => (
                    <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>{row.label}</Text>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>{row.value}</Text>
                    </View>
                  ))}
                </View>

                {/* What we write */}
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.6, marginBottom: 8 }}>WRITES TO HEALTH</Text>
                <View style={{ gap: 6, marginBottom: 14 }}>
                  {[
                    { label: "Body weight",   note: "when you log weight" },
                    { label: "Workouts",      note: "when you finish a session" },
                    { label: "Nutrition",     note: "when you log food" },
                    { label: "Water intake",  note: "when you log water" },
                  ].map(row => (
                    <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>{row.label}</Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted }}>{row.note}</Text>
                    </View>
                  ))}
                </View>

                {/* Import historical weight */}
                <Pressable
                  onPress={syncWeightFromHealth}
                  disabled={hkSyncing}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12,
                    paddingVertical: 10, opacity: pressed || hkSyncing ? 0.6 : 1,
                  })}
                >
                  {hkSyncing
                    ? <ActivityIndicator size="small" color={muted} />
                    : <RefreshCw size={13} color={muted} />
                  }
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: muted }}>
                    {hkSyncing ? "Importing…" : "Import weight history"}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Picker modals ── */}
      <OptionsModal
        {...pickerProps}
        visible={openPicker === "sex"}
        title="Biological Sex"
        options={SEX_OPTIONS}
        value={sex}
        onSelect={setSex}
      />
      <OptionsModal
        {...pickerProps}
        visible={openPicker === "activity"}
        title="Activity Level"
        options={ACTIVITY_OPTIONS}
        value={activityLevel}
        onSelect={setActivityLevel}
      />
      <OptionsModal
        {...pickerProps}
        visible={openPicker === "weightUnit"}
        title="Weight Units"
        options={WEIGHT_UNIT_OPTIONS}
        value={weightUnit}
        onSelect={setWeightUnit}
      />
    </SafeAreaView>
  );
}
