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

// ── Card header with icon box ───────────────────────────────────────────────
function CardHeader({
  icon: Icon, label, iconBg, iconColor, text,
}: { icon: any; label: string; iconBg: string; iconColor: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <View style={{
        width: 30, height: 30, borderRadius: 8,
        backgroundColor: iconBg, alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={15} color={iconColor} />
      </View>
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>{label}</Text>
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
const VOLUME_UNIT_OPTIONS = [
  { label: "Fluid ounces (oz)", value: "oz" },
  { label: "Millilitres (ml)", value: "ml" },
];

function activityLabel(v: string) {
  return ACTIVITY_OPTIONS.find(o => o.value === v)?.label ?? v;
}
function weightUnitLabel(v: string) {
  return WEIGHT_UNIT_OPTIONS.find(o => o.value === v)?.label ?? v;
}
function volumeUnitLabel(v: string) {
  return VOLUME_UNIT_OPTIONS.find(o => o.value === v)?.label ?? v;
}
function sexLabel(v: string) {
  return SEX_OPTIONS.find(o => o.value === v)?.label ?? v;
}

// Accent colour display order for the swatches
const SWATCH_ORDER = ["white", "pink", "blue", "purple", "peach", "dark"];

// ── HealthKit stub for non-iOS ────────────────────────────────────────────
const AppleHealthKit: any = Platform.OS === "ios"
  ? (() => { try { return require("react-native-health").default; } catch { return null; } })()
  : null;

const HK_PERMISSIONS = AppleHealthKit ? {
  permissions: {
    read: [
      AppleHealthKit?.Constants?.Permissions?.HeartRate,
      AppleHealthKit?.Constants?.Permissions?.Weight,
      AppleHealthKit?.Constants?.Permissions?.Steps,
    ].filter(Boolean),
    write: [AppleHealthKit?.Constants?.Permissions?.Weight].filter(Boolean),
  },
} : { permissions: { read: [], write: [] } };

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

  const [ftVal,        setFtVal]        = useState("");
  const [inVal,        setInVal]        = useState("");
  const [birthDate,    setBirthDate]    = useState("");
  const [sex,          setSex]          = useState("male");
  const [activityLevel, setActivityLevel] = useState("moderate");
  const [weightUnit,   setWeightUnit]   = useState("lbs");
  const [volumeUnit,   setVolumeUnit]   = useState("oz");

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
    setVolumeUnit(profile.volumeUnitPreference ?? "oz");
  }, [profile]);

  // ── Save profile ──
  const saveProfile = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/profile", {
      heightCm: ftInToCm(ftVal, inVal),
      birthDate: birthDate || null,
      sex,
      activityLevel,
      weightUnitPreference: weightUnit,
      volumeUnitPreference: volumeUnit,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/profile"] });
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
      Alert.alert("Saved", "Profile updated.");
    },
    onError: () => Alert.alert("Error", "Could not save profile."),
  });

  // ── Log weight ──
  const [weightInput, setWeightInput] = useState("");
  const logWeight = useMutation({
    mutationFn: () => apiRequest("POST", "/api/measurements", {
      date: todayStr(),
      weightGrams: lbsToGrams(parseFloat(weightInput)),
    }),
    onSuccess: () => {
      setWeightInput("");
      qc.invalidateQueries({ queryKey: ["/api/measurements"] });
      Alert.alert("Logged", "Weight saved!");
    },
    onError: () => Alert.alert("Error", "Could not log weight."),
  });

  // ── Apple Health (compact) ──
  const [hkConnected, setHkConnected] = useState(false);
  const [hkSyncing, setHkSyncing] = useState(false);

  const connectHealthKit = useCallback(() => {
    if (!AppleHealthKit) {
      Alert.alert("Not available", "Apple Health is only available on iOS devices.");
      return;
    }
    AppleHealthKit.initHealthKit(HK_PERMISSIONS, (err: any) => {
      if (err) { Alert.alert("Error", String(err)); return; }
      setHkConnected(true);
    });
  }, []);

  const syncHealthKit = useCallback(async () => {
    if (!AppleHealthKit || !hkConnected) { connectHealthKit(); return; }
    setHkSyncing(true);
    try {
      const end = new Date();
      const start = new Date(); start.setDate(start.getDate() - 30);
      const opts = { startDate: start.toISOString(), endDate: end.toISOString(), unit: "pound", limit: 500, ascending: true };
      await new Promise<void>((resolve) => {
        AppleHealthKit.getWeightSamples(opts, async (err: any, results: any[]) => {
          if (err || !results?.length) { resolve(); return; }
          for (const r of results) {
            try {
              await apiRequest("POST", "/api/measurements", {
                date: new Date(r.startDate).toISOString().slice(0, 10),
                weightGrams: Math.round(r.value * 453.592),
              });
            } catch {}
          }
          qc.invalidateQueries({ queryKey: ["/api/measurements"] });
          resolve();
        });
      });
      Alert.alert("Synced", "Weight data imported from Apple Health.");
    } catch (e: any) {
      Alert.alert("Sync failed", e?.message ?? "Unknown error");
    } finally {
      setHkSyncing(false);
    }
  }, [hkConnected, connectHealthKit, qc]);

  // ── Picker modal state ──
  const [openPicker, setOpenPicker] = useState<
    "sex" | "activity" | "weightUnit" | "volumeUnit" | null
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
            <CardHeader icon={User} label="Account" iconBg="rgba(255,255,255,0.08)" iconColor={muted} text={text} />
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
            <CardHeader icon={PaletteIcon} label="Accent Colour" iconBg="rgba(255,255,255,0.08)" iconColor={muted} text={text} />
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
            <CardHeader icon={Scale} label="Log Today's Weight" iconBg="rgba(255,255,255,0.08)" iconColor={muted} text={text} />
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
                  backgroundColor: "#2a2a2a", borderRadius: 12,
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
          </View>

          {/* ── Body Profile ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 14 }}>
            <CardHeader icon={Activity} label="Body Profile" iconBg="rgba(200,232,76,0.12)" iconColor="#c8e84c" text={text} />

            {/* Height row */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 6 }}>Height</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#111111", borderRadius: 12, borderWidth: 1, borderColor: border, paddingHorizontal: 12 }}>
                  <TextInput
                    value={ftVal}
                    onChangeText={setFtVal}
                    placeholder="0"
                    placeholderTextColor={muted}
                    keyboardType="number-pad"
                    maxLength={1}
                    style={{ flex: 1, padding: 12, textAlign: "center", fontFamily: "Manrope-SemiBold", fontSize: 15, color: text }}
                  />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>ft</Text>
                </View>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#111111", borderRadius: 12, borderWidth: 1, borderColor: border, paddingHorizontal: 12 }}>
                  <TextInput
                    value={inVal}
                    onChangeText={setInVal}
                    placeholder="0"
                    placeholderTextColor={muted}
                    keyboardType="number-pad"
                    maxLength={2}
                    style={{ flex: 1, padding: 12, textAlign: "center", fontFamily: "Manrope-SemiBold", fontSize: 15, color: text }}
                  />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>in</Text>
                </View>
              </View>
            </View>

            {/* Date of Birth row */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 6 }}>Date of Birth</Text>
              {Platform.OS === "web" ? (
                <View style={{ backgroundColor: "#111111", borderRadius: 12, borderWidth: 1, borderColor: border, overflow: "hidden" }}>
                  {/* @ts-ignore */}
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e: any) => setBirthDate(e.target.value)}
                    style={{
                      background: "transparent", border: "none", outline: "none",
                      color: birthDate ? "#f4f4f4" : "#888888",
                      fontFamily: "Manrope-SemiBold", fontSize: 13,
                      padding: "12px", width: "100%", boxSizing: "border-box",
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
                  style={{
                    backgroundColor: "#111111", borderRadius: 12, padding: 12,
                    borderWidth: 1, borderColor: border,
                    fontFamily: "Manrope-SemiBold", fontSize: 13, color: text,
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

            {/* Weight Units + Volume Units row */}
            <View style={{ flexDirection: "row", gap: 12, marginBottom: 18 }}>
              <View style={{ flex: 1 }}>
                <SelectPill
                  label="Weight Units"
                  value={weightUnitLabel(weightUnit)}
                  onPress={() => setOpenPicker("weightUnit")}
                  card={card} border={border} text={text} muted={muted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SelectPill
                  label="Volume Units"
                  value={volumeUnitLabel(volumeUnit)}
                  onPress={() => setOpenPicker("volumeUnit")}
                  card={card} border={border} text={text} muted={muted}
                />
              </View>
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
          </View>

          {/* ── Apple Health (compact) ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 14, marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: hkConnected ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
                alignItems: "center", justifyContent: "center",
              }}>
                <Heart size={17} color={hkConnected ? "#ef4444" : muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>Apple Health</Text>
                <Text style={{ fontFamily: "Manrope", fontSize: 11, color: hkConnected ? "#22c55e" : muted }}>
                  {hkConnected ? "Connected · steps, weight" : "Sync steps & weight data"}
                </Text>
              </View>
              <Pressable
                onPress={hkConnected ? syncHealthKit : connectHealthKit}
                disabled={hkSyncing}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 6,
                  backgroundColor: hkConnected ? "#1a1a1a" : "#ef4444",
                  borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
                  opacity: pressed || hkSyncing ? 0.7 : 1,
                })}
              >
                {hkSyncing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <RefreshCw size={13} color={hkConnected ? muted : "#fff"} />
                }
                <Text style={{
                  fontFamily: "Manrope-Bold", fontSize: 12,
                  color: hkConnected ? muted : "#fff",
                }}>
                  {hkSyncing ? "Syncing…" : hkConnected ? "Sync" : "Connect"}
                </Text>
              </Pressable>
            </View>
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
      <OptionsModal
        {...pickerProps}
        visible={openPicker === "volumeUnit"}
        title="Volume Units"
        options={VOLUME_UNIT_OPTIONS}
        value={volumeUnit}
        onSelect={setVolumeUnit}
      />
    </SafeAreaView>
  );
}
