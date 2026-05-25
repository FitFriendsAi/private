import { useState, useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  View, Text, ScrollView, Pressable, TextInput,
  Modal, ActivityIndicator, Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useHealth } from "@/hooks/use-health";
import { todayStr, nowTimeStr, timeStrToISO, fmtTime } from "@/lib/utils";
import { Plus, Search, X, ChevronRight, UtensilsCrossed, Trash2, ScanLine, Camera, PenLine, ChevronDown } from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealType = typeof MEALS[number];

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

const LIME   = "#c8e84c";
const BLUE   = "#9bd1ff";
const PURPLE = "#d3a8ff";
const DOT: object = { fontFamily: "Doto" };

interface FoodItem {
  id: number;
  name: string;
  brand?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSizeG: number;
  servingUnit?: string;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
  saturatedFatG?: number;
  transFatG?: number;
  cholesterolMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  vitaminDMcg?: number;
  vitaminCMg?: number;
  source?: string;
}

interface FoodLogEntry {
  id: number;
  mealType: MealType;
  foodItemId: number;
  foodName?: string;
  servings: number;
  caloriesActual: number;
  proteinActual: number;
  carbsActual: number;
  fatActual: number;
  loggedAt?: string | null;
  foodItem?: FoodItem;
}


interface MealIngredient {
  id: number;
  mealId: number;
  foodItemId?: number;
  foodName: string;
  servings: number;
  caloriesActual: number;
  proteinActual: number;
  carbsActual: number;
  fatActual: number;
}

interface SavedMeal {
  id: number;
  name: string;
  description?: string;
  ingredients: MealIngredient[];
}

// ── Calorie donut ─────────────────────────────────────────────────
function CalorieDonut({
  eaten, goal, size = 120, strokeWidth = 10,
}: { eaten: number; goal: number; size?: number; strokeWidth?: number }) {
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = goal > 0 ? Math.min(eaten / goal, 1) : 0;
  const dash = pct * circ;
  const left = Math.max(0, goal - eaten);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke="#e0e0e0" strokeWidth={strokeWidth} fill="none" />
        {pct > 0 && (
          <Circle cx={size/2} cy={size/2} r={r} stroke="#0a0a0a" strokeWidth={strokeWidth} fill="none"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} />
        )}
      </Svg>
      <Text style={{ ...(DOT as any), fontSize: 26, color: "#0a0a0a", lineHeight: 28 }}>{left.toLocaleString()}</Text>
      <Text style={{ fontSize: 9, fontFamily: "Manrope-Bold", color: "#888888", letterSpacing: 0.8, marginTop: 2 }}>LEFT</Text>
    </View>
  );
}

// ── Macro totals for a meal's ingredients ─────────────────────────
function mealTotals(ingredients: MealIngredient[]) {
  return ingredients.reduce(
    (acc, i) => ({
      calories: acc.calories + i.caloriesActual,
      protein:  acc.protein  + i.proteinActual,
      carbs:    acc.carbs    + i.carbsActual,
      fat:      acc.fat      + i.fatActual,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

// ── Main component ────────────────────────────────────────────────
export default function FoodScreen() {
  const today = todayStr(); // recomputed on every render so date resets correctly at midnight
  const { palette, isWhite } = useTheme();
  const qc = useQueryClient();
  const health = useHealth();

  // ── Tab: "log" | "meals" ──
  const [tab, setTab] = useState<"log" | "meals">("log");

  // ── Add food modal ──
  const [showAdd, setShowAdd]               = useState(false);
  const [activeMeal, setActiveMeal]         = useState<MealType>("breakfast");
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState<FoodItem[]>([]);
  const [searching, setSearching]           = useState(false);
  const [selectedItem, setSelectedItem]     = useState<FoodItem | null>(null);
  const [servings, setServings]             = useState("1");
  const [logTime, setLogTime]               = useState(nowTimeStr);
  // ── Create meal modal ──
  const [showCreateMeal, setShowCreateMeal]         = useState(false);
  const [newMealName, setNewMealName]               = useState("");
  const [newMealDesc, setNewMealDesc]               = useState("");
  const [newMealIngredients, setNewMealIngredients] = useState<
    { foodItem: FoodItem; servings: number }[]
  >([]);

  // ── Ingredient picker embedded inside Create Meal modal ──
  const [mealPickerPage, setMealPickerPage]         = useState<"search" | "item" | null>(null);
  const [mealPickerQuery, setMealPickerQuery]       = useState("");
  const [mealPickerResults, setMealPickerResults]   = useState<FoodItem[]>([]);
  const [mealPickerSearching, setMealPickerSearching] = useState(false);
  const [mealPickerItem, setMealPickerItem]         = useState<FoodItem | null>(null);
  const [mealPickerServings, setMealPickerServings] = useState("1");

  // ── Food detail modal ──
  const [detailEntry, setDetailEntry]     = useState<FoodLogEntry | null>(null);
  const [detailItem,  setDetailItem]      = useState<FoodItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function openDetail(entry: FoodLogEntry) {
    setDetailEntry(entry);
    setDetailItem(null);
    if (entry.foodItemId) {
      setDetailLoading(true);
      try {
        const item = await apiRequest<FoodItem>("GET", `/api/food/items/${entry.foodItemId}`);
        setDetailItem(item);
      } catch {
        // fall back to whatever is in the entry
      } finally {
        setDetailLoading(false);
      }
    }
  }

  // ── Queries ──
  const { data: foodLog = [] } = useQuery<FoodLogEntry[]>({
    queryKey: ["/api/food-log", today],
    queryFn:  () => apiRequest("GET", `/api/food-log?date=${today}`),
  });
  const { data: targets } = useQuery<any>({
    queryKey: ["/api/targets"],
    queryFn:  () => apiRequest("GET", "/api/targets"),
  });
  const { data: savedMeals = [] } = useQuery<SavedMeal[]>({
    queryKey: ["/api/meals"],
    queryFn:  () => apiRequest("GET", "/api/meals"),
  });

  // ── Mutations ──
  const addEntry = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/food-log", data),
    onSuccess: (_res, data) => {
      qc.invalidateQueries({ queryKey: ["/api/food-log", today] });
      // Write nutrition to Apple Health silently
      if (health.authorized) {
        const mealLabel = (data.mealType as string);
        const mealType =
          mealLabel === "breakfast" ? "Breakfast" :
          mealLabel === "lunch"     ? "Lunch"     :
          mealLabel === "dinner"    ? "Dinner"    : "Snack";
        health.writeFood({
          mealName:  mealLabel.charAt(0).toUpperCase() + mealLabel.slice(1),
          mealType,
          calories:  Math.round(data.caloriesActual ?? 0),
          proteinG:  Math.round(data.proteinActual  ?? 0),
          carbsG:    Math.round(data.carbsActual    ?? 0),
          fatG:      Math.round(data.fatActual      ?? 0),
        });
      }
      closeAddModal();
    },
  });

  const deleteEntry = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/food-log/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/food-log", today] }),
  });

  const logMeal = useMutation({
    mutationFn: ({ mealId, mealType }: { mealId: number; mealType: MealType }) =>
      apiRequest("POST", `/api/meals/${mealId}/log`, { date: today, mealType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/food-log", today] });
      setTab("log");
    },
  });

  const createMeal = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/meals", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/meals"] });
      setShowCreateMeal(false);
      setNewMealName("");
      setNewMealDesc("");
      setNewMealIngredients([]);
    },
  });

  const deleteMeal = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/meals/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/meals"] }),
  });

  // ── Helpers ──
  function closeAddModal() {
    setShowAdd(false);
    setSelectedItem(null);
    setSearchQuery("");
    setSearchResults([]);
    setServings("1");
    setLogTime(nowTimeStr());
    setSearchFilter("all");
    resetAddModal();
  }

  function openAddForMeal(meal: MealType) {
    setActiveMeal(meal);
    setSelectedItem(null);
    setSearchQuery("");
    setSearchResults([]);
    setServings("1");
    setLogTime(nowTimeStr());
    resetAddModal();
    setShowAdd(true);
  }


  // ── Add food modal view: "home" | "search" | "manual" | "barcode" ─────────
  const [addView, setAddView] = useState<"home" | "search" | "manual" | "barcode">("home");
  const [showMealPicker, setShowMealPicker] = useState(false);

  // ── Barcode scanner state ─────────────────────────────────────────────────
  const [barcodeError, setBarcodeError]           = useState("");
  const [barcodeManualCode, setBarcodeManualCode] = useState("");
  const [barcodeLoading, setBarcodeLoading]       = useState(false);

  // ── Scan label state ──────────────────────────────────────────────────────
  const [scanLabelLoading, setScanLabelLoading] = useState(false);
  const [scanLabelError, setScanLabelError]     = useState("");

  // Manual entry state
  const [manualName, setManualName]       = useState("");
  const [manualCals, setManualCals]       = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs]     = useState("");
  const [manualFat, setManualFat]         = useState("");

  function resetAddModal() {
    setAddView("home");
    setShowMealPicker(false);
    setManualName(""); setManualCals(""); setManualProtein(""); setManualCarbs(""); setManualFat("");
    setBarcodeError(""); setBarcodeManualCode(""); setBarcodeLoading(false);
    setScanLabelError(""); setScanLabelLoading(false);
  }

  // ── Search filter: "all" | "restaurant" ──────────────────────────────────
  const [searchFilter, setSearchFilter] = useState<"all" | "restaurant">("all");

  // ── Debounced live search ──────────────────────────────────────────────────
  const searchTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mealSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchResults([]); // clear stale results immediately so old query doesn't persist
    searchTimer.current = setTimeout(async () => {
      try {
        const typeParam = searchFilter === "restaurant" ? "&type=restaurant" : "";
        const results = await apiRequest<FoodItem[]>("GET", `/api/food/search?q=${encodeURIComponent(q)}${typeParam}`);
        setSearchResults(results);
      } catch {
        // silent — don't alert on background debounce failures
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, searchFilter]);

  // ── Debounced search for the embedded ingredient picker ───────────────────
  useEffect(() => {
    if (mealSearchTimer.current) clearTimeout(mealSearchTimer.current);
    const q = mealPickerQuery.trim();
    if (q.length < 2) { setMealPickerResults([]); setMealPickerSearching(false); return; }
    setMealPickerSearching(true);
    setMealPickerResults([]);
    mealSearchTimer.current = setTimeout(async () => {
      try {
        const results = await apiRequest<FoodItem[]>("GET", `/api/food/search?q=${encodeURIComponent(q)}`);
        setMealPickerResults(results);
      } catch {
        // silent
      } finally {
        setMealPickerSearching(false);
      }
    }, 220);
    return () => { if (mealSearchTimer.current) clearTimeout(mealSearchTimer.current); };
  }, [mealPickerQuery]);

  function closeMealPicker() {
    setMealPickerPage(null);
    setMealPickerQuery("");
    setMealPickerResults([]);
    setMealPickerItem(null);
    setMealPickerServings("1");
  }

  function addIngredientToMeal() {
    if (!mealPickerItem) return;
    const sv = parseFloat(mealPickerServings) || 1;
    setNewMealIngredients(prev => [...prev, { foodItem: mealPickerItem!, servings: sv }]);
    closeMealPicker();
  }

  function addToLog() {
    if (!selectedItem) return;
    const sv = parseFloat(servings) || 1;
    addEntry.mutate({
      date: today,
      mealType: activeMeal,
      foodItemId: selectedItem.id,
      foodName: selectedItem.name,
      servings: sv,
      caloriesActual: Math.round(selectedItem.calories * sv),
      proteinActual:  Math.round(selectedItem.proteinG * sv * 10) / 10,
      carbsActual:    Math.round(selectedItem.carbsG   * sv * 10) / 10,
      fatActual:      Math.round(selectedItem.fatG     * sv * 10) / 10,
      loggedAt: timeStrToISO(logTime),
    });
  }


  function saveMeal() {
    if (!newMealName.trim() || newMealIngredients.length === 0) {
      Alert.alert("Add a name and at least one ingredient");
      return;
    }
    createMeal.mutate({
      name: newMealName,
      description: newMealDesc || undefined,
      ingredients: newMealIngredients.map(({ foodItem, servings: sv }) => ({
        foodItemId: foodItem.id,
        foodName: foodItem.name,
        servings: sv,
        caloriesActual: Math.round(foodItem.calories * sv),
        proteinActual:  Math.round(foodItem.proteinG * sv * 10) / 10,
        carbsActual:    Math.round(foodItem.carbsG   * sv * 10) / 10,
        fatActual:      Math.round(foodItem.fatG     * sv * 10) / 10,
      })),
    });
  }

  function addManualToLog() {
    if (!manualName.trim()) return Alert.alert("Enter a food name");
    const cals = parseFloat(manualCals) || 0;
    const sv = parseFloat(servings) || 1;
    addEntry.mutate({
      date: today, mealType: activeMeal,
      foodName: manualName.trim(), servings: sv,
      caloriesActual: cals,
      proteinActual: parseFloat(manualProtein) || 0,
      carbsActual:   parseFloat(manualCarbs)   || 0,
      fatActual:     parseFloat(manualFat)     || 0,
      loggedAt: timeStrToISO(logTime),
    });
  }

  // ── Barcode lookup ────────────────────────────────────────────────────────
  async function lookupBarcodeCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBarcodeLoading(true);
    setBarcodeError("");
    try {
      const item = await apiRequest<FoodItem>("GET", `/api/food/barcode/${encodeURIComponent(trimmed)}`);
      setSelectedItem(item);
      setAddView("home"); // selectedItem set → serving selector renders
    } catch {
      setBarcodeError("Product not found. Try a different barcode or search by name.");
    } finally {
      setBarcodeLoading(false);
    }
  }

  /** Resize a blob/file URL to max maxPx on its longest side and return a data URL. */
  function resizeImageForDecode(objectUrl: string, maxPx = 1400): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.onerror = reject;
      img.src = objectUrl;
    });
  }

  // ── Open camera to photograph a barcode (web only) ────────────────────────
  function openBarcodeCapture() {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    (input as any).capture = "environment";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setBarcodeLoading(true);
      setBarcodeError("");
      const objectUrl = URL.createObjectURL(file);
      try {
        // ① Native BarcodeDetector — fastest, available in Chrome & iOS 17.4+
        if ("BarcodeDetector" in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "qr_code", "data_matrix", "itf"],
          });
          const bitmap = await createImageBitmap(file);
          const barcodes = await detector.detect(bitmap);
          if (barcodes.length > 0) {
            URL.revokeObjectURL(objectUrl);
            await lookupBarcodeCode(barcodes[0].rawValue);
            return;
          }
          // No result from native detector — fall through to ZXing
        }

        // ② ZXing — works on iOS Safari, Firefox, and older Chrome
        // Resize the image first: full-res iPhone photos (12MP+) can crash canvas decode
        const resizedUrl = await resizeImageForDecode(objectUrl, 1400);
        URL.revokeObjectURL(objectUrl);
        const reader = new BrowserMultiFormatReader();
        const result = await (reader as any).decodeFromImageUrl(resizedUrl);
        if (result) {
          await lookupBarcodeCode(result.getText());
        } else {
          setBarcodeError("No barcode found. Try a closer shot or type the number below.");
        }
      } catch {
        URL.revokeObjectURL(objectUrl);
        setBarcodeError("Couldn't read barcode. Try a different angle or type the number below.");
      } finally {
        setBarcodeLoading(false);
      }
    };
    input.click();
  }

  // ── Open camera to photograph a nutrition label (web only) ────────────────
  function openScanLabel() {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    (input as any).capture = "environment";
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setScanLabelLoading(true);
      setScanLabelError("");
      const fr = new FileReader();
      fr.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        const [header, base64] = dataUrl.split(",");
        const mediaType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
        try {
          // Claude Vision extracts nutrition facts
          const data = await apiRequest<any>("POST", "/api/food/scan-label", { imageBase64: base64, mediaType });
          // Persist as a food item so the log entry has a real id
          const item = await apiRequest<FoodItem>("POST", "/api/food/items", {
            name: data.name || "Scanned Food",
            brand: data.brand || undefined,
            servingSizeG: data.servingSizeG || 100,
            servingUnit: data.servingUnit || "serving",
            calories: data.calories || 0,
            proteinG: data.proteinG || 0,
            carbsG: data.carbsG || 0,
            fatG: data.fatG || 0,
            fiberG: data.fiberG || undefined,
            sodiumMg: data.sodiumMg || undefined,
            sugarG: data.sugarG || undefined,
            source: "custom",
          });
          setSelectedItem(item); // → serving selector
        } catch {
          setScanLabelError("Couldn't read the label. Try a clearer, well-lit photo.");
        } finally {
          setScanLabelLoading(false);
        }
      };
      fr.readAsDataURL(file);
    };
    input.click();
  }

  const { card, cardBorder: border, text, muted, bg, accent, accentText } = palette;
  const accentActive = accent === "#ffffff" ? "#0a0a0a" : accent;

  const totals = foodLog.reduce(
    (acc, e) => ({
      calories: acc.calories + e.caloriesActual,
      protein:  acc.protein  + e.proteinActual,
      carbs:    acc.carbs    + e.carbsActual,
      fat:      acc.fat      + e.fatActual,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const calGoal     = targets?.calories ?? 2200;
  const proteinGoal = targets?.proteinG ?? 150;
  const carbsGoal   = targets?.carbsG   ?? 220;
  const fatGoal     = targets?.fatG     ?? 70;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, paddingTop: 4 }}>
          <View>
            <Text style={{ fontSize: 28, fontFamily: "Manrope-ExtraBold", color: text, letterSpacing: -0.5 }}>Food Log</Text>
            <Text style={{ fontSize: 13, fontFamily: "Manrope", color: muted, marginTop: 2 }}>Today</Text>
          </View>
          <Pressable
            onPress={() => openAddForMeal(activeMeal)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: "#ffffff", borderRadius: 22,
              paddingHorizontal: 16, paddingVertical: 10,
              opacity: pressed ? 0.8 : 1, marginTop: 4,
            })}
          >
            <Plus size={14} color="#0a0a0a" strokeWidth={2.5} />
            <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#0a0a0a" }}>Add Food</Text>
          </Pressable>
        </View>

        {/* ── Summary card ── */}
        <View style={{ backgroundColor: "#ffffff", borderRadius: 24, padding: 20, marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 20 }}>
          <CalorieDonut eaten={Math.round(totals.calories)} goal={calGoal} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: "#888888", letterSpacing: 0.8, marginBottom: 4 }}>EATEN · TODAY</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 14 }}>
              <Text style={{ ...(DOT as any), fontSize: 26, color: "#0a0a0a", lineHeight: 28 }}>{Math.round(totals.calories)}</Text>
              <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: "#888888" }}>/ {calGoal}</Text>
            </View>
            {([
              { label: "PROTEIN", val: Math.round(totals.protein), goal: proteinGoal, color: LIME   },
              { label: "CARBS",   val: Math.round(totals.carbs),   goal: carbsGoal,   color: BLUE   },
              { label: "FAT",     val: Math.round(totals.fat),     goal: fatGoal,     color: PURPLE },
            ] as const).map(m => (
              <View key={m.label} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginBottom: 3 }}>
                  <Text style={{ fontSize: 9, fontFamily: "Manrope-Bold", color: "#888888", letterSpacing: 0.6 }}>{m.label}</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "#0a0a0a" }}>{m.val}</Text>
                  <Text style={{ fontSize: 9, fontFamily: "Manrope-Bold", color: "#888888" }}>/{m.goal}g</Text>
                </View>
                <View style={{ height: 3, backgroundColor: "#e0e0e0", borderRadius: 2, overflow: "hidden" }}>
                  <View style={{ width: `${Math.min(m.goal > 0 ? (m.val / m.goal) * 100 : 0, 100)}%` as any, height: "100%", backgroundColor: m.color, borderRadius: 2 }} />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Tab toggle: Log / Meals ── */}
        <View style={{ flexDirection: "row", backgroundColor: card, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: border, marginBottom: 16 }}>
          {(["log", "meals"] as const).map(t => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={{
                flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: "center",
                backgroundColor: tab === t ? "#ffffff" : "transparent",
              }}
            >
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: tab === t ? "#0a0a0a" : muted }}>
                {t === "log" ? "Today's Log" : "Saved Meals"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Tab: Today's Log ── */}
        {tab === "log" && MEALS.map(meal => {
          const entries  = foodLog.filter(e => e.mealType === meal);
          const mealCals = entries.reduce((s, e) => s + e.caloriesActual, 0);
          return (
            <View key={meal} style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, marginBottom: 10 }}>
              <Pressable
                onPress={() => openAddForMeal(meal)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 18, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontSize: 16, fontFamily: "Manrope-Bold", color: text }}>{MEAL_LABELS[meal]}</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Manrope", color: muted }}>{mealCals > 0 ? `${mealCals} Kcal` : "0 Kcal"}</Text>
                </View>
                <Plus size={18} color={muted} strokeWidth={2} />
              </Pressable>
              {entries.map(entry => (
                <Pressable
                  key={entry.id}
                  onPress={() => openDetail(entry)}
                  style={({ pressed }) => ({
                    borderTopWidth: 1, borderTopColor: border,
                    paddingHorizontal: 18, paddingVertical: 12,
                    flexDirection: "row", alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: "Manrope-SemiBold", color: text, flex: 1, marginRight: 6 }}>
                        {entry.foodName ?? entry.foodItem?.name ?? `Food #${entry.foodItemId}`}
                      </Text>
                      {entry.loggedAt ? (
                        <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, flexShrink: 0 }}>
                          {fmtTime(entry.loggedAt)}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: muted }}>{entry.caloriesActual} kcal</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope", color: LIME }}>P {Math.round(entry.proteinActual)}g</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope", color: BLUE }}>C {Math.round(entry.carbsActual)}g</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope", color: PURPLE }}>F {Math.round(entry.fatActual)}g</Text>
                    </View>
                  </View>
                  <Pressable onPress={() => deleteEntry.mutate(entry.id)} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}>
                    <X size={15} color={muted} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          );
        })}

        {/* ── Tab: Saved Meals ── */}
        {tab === "meals" && (
          <>
            {/* Create new meal button */}
            <Pressable
              onPress={() => { setNewMealName(""); setNewMealDesc(""); setNewMealIngredients([]); setShowCreateMeal(true); }}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                borderRadius: 20, borderWidth: 1.5, borderColor: border, borderStyle: "dashed",
                paddingVertical: 16, marginBottom: 14, opacity: pressed ? 0.7 : 1,
              })}
            >
              <Plus size={16} color={muted} />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>Create New Meal</Text>
            </Pressable>

            {savedMeals.length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <UtensilsCrossed size={32} color={muted} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, marginTop: 12 }}>No saved meals yet</Text>
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 4, textAlign: "center" }}>
                  Save frequently eaten combos{"\n"}for one-tap logging
                </Text>
              </View>
            )}

            {savedMeals.map(meal => {
              const t = mealTotals(meal.ingredients);
              return (
                <View key={meal.id} style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, marginBottom: 10, overflow: "hidden" }}>
                  {/* Meal header */}
                  <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontFamily: "Manrope-Bold", color: text }}>{meal.name}</Text>
                        {meal.description ? (
                          <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted, marginTop: 2 }}>{meal.description}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => Alert.alert("Delete meal", `Delete "${meal.name}"?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteMeal.mutate(meal.id) },
                        ])}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4, marginLeft: 8 })}
                      >
                        <Trash2 size={15} color={muted} />
                      </Pressable>
                    </View>

                    {/* Macro summary */}
                    <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }}>
                      <View style={{ flex: 1, backgroundColor: bg, borderRadius: 10, padding: 8, alignItems: "center" }}>
                        <Text style={{ ...(DOT as any), fontSize: 16, color: text }}>{Math.round(t.calories)}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: muted, marginTop: 2 }}>KCAL</Text>
                      </View>
                      {([
                        { label: "P", val: Math.round(t.protein),  color: LIME   },
                        { label: "C", val: Math.round(t.carbs),    color: BLUE   },
                        { label: "F", val: Math.round(t.fat),      color: PURPLE },
                      ]).map(m => (
                        <View key={m.label} style={{ flex: 1, backgroundColor: bg, borderRadius: 10, padding: 8, alignItems: "center" }}>
                          <Text style={{ ...(DOT as any), fontSize: 16, color: m.color }}>{m.val}</Text>
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: muted, marginTop: 2 }}>{m.label} (g)</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Ingredient list */}
                  {meal.ingredients.map((ing, idx) => (
                    <View key={ing.id} style={{ borderTopWidth: 1, borderTopColor: border, paddingHorizontal: 18, paddingVertical: 10, flexDirection: "row", alignItems: "center" }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: muted, marginRight: 10, opacity: 0.5 }} />
                      <Text style={{ flex: 1, fontSize: 12, fontFamily: "Manrope-SemiBold", color: text }}>{ing.foodName}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>{ing.servings}× · {Math.round(ing.caloriesActual)} kcal</Text>
                    </View>
                  ))}

                  {/* Quick-log row */}
                  <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: border }}>
                    {MEALS.map((m, i) => (
                      <Pressable
                        key={m}
                        onPress={() => logMeal.mutate({ mealId: meal.id, mealType: m })}
                        disabled={logMeal.isPending}
                        style={({ pressed }) => ({
                          flex: 1, paddingVertical: 12, alignItems: "center",
                          borderRightWidth: i < MEALS.length - 1 ? 1 : 0, borderRightColor: border,
                          opacity: pressed || logMeal.isPending ? 0.6 : 1,
                        })}
                      >
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: accentActive }}>
                          {MEAL_LABELS[m]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* ── Food Detail Modal ── */}
      <Modal
        visible={!!detailEntry}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setDetailEntry(null); setDetailItem(null); }}
      >
        {detailEntry && (() => {
          const e    = detailEntry;
          const item = detailItem ?? e.foodItem ?? null;
          const name = item?.name ?? e.foodName ?? `Food #${e.foodItemId}`;
          const brand = item?.brand;

          // Actuals (what was actually logged for this serving count)
          const totalCal = Math.round(e.caloriesActual);
          const p = Math.round(e.proteinActual);
          const c = Math.round(e.carbsActual);
          const f = Math.round(e.fatActual);

          // Per-serving from item (if available), scaled by number of servings logged
          const servSizeG    = item?.servingSizeG;
          const servUnit     = item?.servingUnit ?? "g";
          const sv           = e.servings;
          const scale1dp     = (v: number | undefined | null) => v != null ? Math.round(v * sv * 10) / 10 : null;
          const scale0dp     = (v: number | undefined | null) => v != null ? Math.round(v * sv)          : null;
          const scale2dp     = (v: number | undefined | null) => v != null ? Math.round(v * sv * 100) / 100 : null;

          const fiberG       = scale1dp(item?.fiberG);
          const sugarG       = scale1dp(item?.sugarG);
          const sodiumMg     = scale0dp(item?.sodiumMg);
          const saturatedFatG = scale1dp(item?.saturatedFatG);
          const transFatG    = scale1dp(item?.transFatG);
          const cholesterolMg = scale0dp(item?.cholesterolMg);
          const potassiumMg  = scale0dp(item?.potassiumMg);
          const calciumMg    = scale0dp(item?.calciumMg);
          const ironMg       = scale2dp(item?.ironMg);
          const vitaminDMcg  = scale1dp(item?.vitaminDMcg);
          const vitaminCMg   = scale1dp(item?.vitaminCMg);

          const calFromP   = p * 4, calFromC = c * 4, calFromF = f * 9;
          const macroTotal = calFromP + calFromC + calFromF || 1;

          return (
            <View style={{ flex: 1, backgroundColor: bg }}>
              {/* Header */}
              <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: border }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }} numberOfLines={2}>{name}</Text>
                  {brand ? <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>{brand}</Text> : null}
                </View>
                <Pressable onPress={() => { setDetailEntry(null); setDetailItem(null); }} hitSlop={8}>
                  <X size={22} color={text} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>

                {/* Serving + loading */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                    {e.servings === 1 ? "1 serving" : `${e.servings} servings`}
                    {servSizeG ? `  ·  ${Math.round(servSizeG * e.servings)}${servUnit}` : ""}
                  </Text>
                  {detailLoading && <ActivityIndicator size="small" color={accent} />}
                </View>

                {/* Calories hero */}
                <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 20, alignItems: "center", marginBottom: 12 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 4 }}>CALORIES</Text>
                  <Text style={{ ...(DOT as any), fontSize: 52, color: text, lineHeight: 56 }}>{totalCal}</Text>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginTop: 4 }}>kcal</Text>
                </View>

                {/* Macro cards */}
                {([
                  { label: "Protein", val: p,  color: LIME,   calPct: calFromP / macroTotal, kcal: calFromP },
                  { label: "Carbs",   val: c,  color: BLUE,   calPct: calFromC / macroTotal, kcal: calFromC },
                  { label: "Fat",     val: f,  color: PURPLE, calPct: calFromF / macroTotal, kcal: calFromF },
                ] as const).map(m => (
                  <View key={m.label} style={{ backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>{m.label}</Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                        <Text style={{ ...(DOT as any), fontSize: 22, color: m.color, lineHeight: 26 }}>{m.val}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted }}>g</Text>
                      </View>
                    </View>
                    <View style={{ height: 5, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                      <View style={{ width: `${Math.round(m.calPct * 100)}%` as any, height: "100%", backgroundColor: m.color, borderRadius: 3 }} />
                    </View>
                    <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, marginTop: 5 }}>
                      {Math.round(m.calPct * 100)}% of calories  ·  {m.kcal} kcal
                    </Text>
                  </View>
                ))}

                {/* Additional nutrients */}
                <View style={{ backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 8 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text, marginBottom: 4 }}>Nutrition Details</Text>
                  {([
                    // Fats
                    { label: "Saturated Fat",  val: saturatedFatG != null ? `${saturatedFatG}g`  : null, color: "#f97316" },
                    { label: "Trans Fat",      val: transFatG     != null ? `${transFatG}g`      : null, color: "#ef4444" },
                    // Cholesterol & sodium
                    { label: "Cholesterol",    val: cholesterolMg != null ? `${cholesterolMg}mg` : null, color: "#fbbf24" },
                    { label: "Sodium",         val: sodiumMg      != null ? `${sodiumMg}mg`      : null, color: "#94a3b8" },
                    // Carbs breakdown
                    { label: "Dietary Fiber",  val: fiberG        != null ? `${fiberG}g`         : null, color: "#4ade80" },
                    { label: "Total Sugars",   val: sugarG        != null ? `${sugarG}g`         : null, color: "#fb923c" },
                    // Minerals
                    { label: "Potassium",      val: potassiumMg   != null ? `${potassiumMg}mg`   : null, color: "#a78bfa" },
                    { label: "Calcium",        val: calciumMg     != null ? `${calciumMg}mg`     : null, color: "#67e8f9" },
                    { label: "Iron",           val: ironMg        != null ? `${ironMg}mg`        : null, color: "#f87171" },
                    // Vitamins
                    { label: "Vitamin D",      val: vitaminDMcg   != null ? `${vitaminDMcg}µg`   : null, color: "#fde68a" },
                    { label: "Vitamin C",      val: vitaminCMg    != null ? `${vitaminCMg}mg`    : null, color: "#86efac" },
                  ] as { label: string; val: string | null; color: string }[])
                    .filter(row => row.val != null) // only show fields we actually have data for
                    .map((row) => (
                      <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: border }}>
                        <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>{row.label}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: row.color }}>
                          {row.val}
                        </Text>
                      </View>
                    ))
                  }
                  {/* If we have NO detail fields at all, show a placeholder */}
                  {[saturatedFatG, transFatG, cholesterolMg, sodiumMg, fiberG, sugarG,
                    potassiumMg, calciumMg, ironMg, vitaminDMcg, vitaminCMg].every(v => v == null) && (
                    <View style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: border, alignItems: "center" }}>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>No additional data available</Text>
                    </View>
                  )}
                </View>

                {/* Remove button */}
                <Pressable
                  onPress={() => {
                    Alert.alert("Remove item?", `Remove ${name} from today's log?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => {
                        deleteEntry.mutate(e.id);
                        setDetailEntry(null);
                        setDetailItem(null);
                      }},
                    ]);
                  }}
                  style={({ pressed }) => ({
                    marginTop: 8, paddingVertical: 14, borderRadius: 16, alignItems: "center",
                    backgroundColor: "rgba(239,68,68,0.1)", opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#ef4444" }}>Remove from Log</Text>
                </Pressable>
              </ScrollView>
            </View>
          );
        })()}
      </Modal>

      {/* ── Create Meal Modal ── */}
      <Modal visible={showCreateMeal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg }}>

          {/* Header — changes based on picker page */}
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: border }}>
            {mealPickerPage ? (
              <Pressable onPress={closeMealPicker} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted }}>Back</Text>
              </Pressable>
            ) : (
              <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>New Saved Meal</Text>
            )}
            <Pressable onPress={() => { setShowCreateMeal(false); closeMealPicker(); setNewMealName(""); setNewMealDesc(""); setNewMealIngredients([]); }}>
              <X size={22} color={text} />
            </Pressable>
          </View>

          {/* ── PAGE: Meal form ── */}
          {!mealPickerPage && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>MEAL NAME</Text>
              <TextInput
                value={newMealName}
                onChangeText={setNewMealName}
                placeholder="e.g. My usual breakfast"
                placeholderTextColor={muted}
                style={{ backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 14, color: text, marginBottom: 14 }}
              />

              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>DESCRIPTION (OPTIONAL)</Text>
              <TextInput
                value={newMealDesc}
                onChangeText={setNewMealDesc}
                placeholder="e.g. Chicken & rice meal prep"
                placeholderTextColor={muted}
                style={{ backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 14, color: text, marginBottom: 20 }}
              />

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8 }}>
                  INGREDIENTS ({newMealIngredients.length})
                </Text>
                <Pressable
                  onPress={() => setMealPickerPage("search")}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
                >
                  <Plus size={14} color={accentActive} />
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: accentActive }}>Add Food</Text>
                </Pressable>
              </View>

              {newMealIngredients.length === 0 && (
                <Pressable
                  onPress={() => setMealPickerPage("search")}
                  style={({ pressed }) => ({
                    borderRadius: 14, borderWidth: 1.5, borderColor: border, borderStyle: "dashed",
                    paddingVertical: 20, alignItems: "center", marginBottom: 16, opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>Tap to add ingredients</Text>
                </Pressable>
              )}

              {newMealIngredients.map((ing, i) => (
                <View key={i} style={{ backgroundColor: card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, marginBottom: 8, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>{ing.foodItem.name}</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, marginTop: 2 }}>
                      {ing.servings}× · {Math.round(ing.foodItem.calories * ing.servings)} kcal
                    </Text>
                  </View>
                  <Pressable onPress={() => setNewMealIngredients(prev => prev.filter((_, j) => j !== i))} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                    <X size={15} color={muted} />
                  </Pressable>
                </View>
              ))}

              {newMealIngredients.length > 0 && (() => {
                const t = newMealIngredients.reduce(
                  (acc, { foodItem, servings: sv }) => ({
                    calories: acc.calories + foodItem.calories * sv,
                    protein:  acc.protein  + foodItem.proteinG * sv,
                    carbs:    acc.carbs    + foodItem.carbsG   * sv,
                    fat:      acc.fat      + foodItem.fatG     * sv,
                  }),
                  { calories: 0, protein: 0, carbs: 0, fat: 0 }
                );
                return (
                  <View style={{ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 20, flexDirection: "row", justifyContent: "space-around" }}>
                    {[
                      { label: "KCAL", val: Math.round(t.calories), color: text },
                      { label: "P",    val: Math.round(t.protein),  color: LIME   },
                      { label: "C",    val: Math.round(t.carbs),    color: BLUE   },
                      { label: "F",    val: Math.round(t.fat),      color: PURPLE },
                    ].map(m => (
                      <View key={m.label} style={{ alignItems: "center" }}>
                        <Text style={{ ...(DOT as any), fontSize: 18, color: m.color }}>{m.val}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: muted, marginTop: 2 }}>{m.label}</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}

              <Pressable
                onPress={saveMeal}
                disabled={createMeal.isPending || !newMealName.trim() || newMealIngredients.length === 0}
                style={({ pressed }) => ({
                  backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center",
                  opacity: (pressed || createMeal.isPending || !newMealName.trim() || newMealIngredients.length === 0) ? 0.6 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                  {createMeal.isPending ? "Saving…" : "Save Meal"}
                </Text>
              </Pressable>
            </ScrollView>
          )}

          {/* ── PAGE: Ingredient search ── */}
          {mealPickerPage === "search" && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {/* Search bar */}
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 14 }}>
                {mealPickerSearching
                  ? <ActivityIndicator size="small" color={muted} style={{ width: 18 }} />
                  : <Search size={18} color={muted} />
                }
                <TextInput
                  value={mealPickerQuery}
                  onChangeText={setMealPickerQuery}
                  placeholder="Search food, restaurant, or brand…"
                  placeholderTextColor={muted}
                  returnKeyType="search"
                  autoFocus
                  style={{ flex: 1, color: text, fontFamily: "Manrope", fontSize: 15, padding: 0 }}
                />
                {mealPickerQuery.length > 0 && (
                  <Pressable onPress={() => { setMealPickerQuery(""); setMealPickerResults([]); }} hitSlop={8}>
                    <X size={16} color={muted} />
                  </Pressable>
                )}
              </View>

              {mealPickerQuery.length >= 2 && mealPickerResults.length === 0 && !mealPickerSearching && (
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, textAlign: "center", marginTop: 10 }}>No results found</Text>
              )}

              {mealPickerResults.map(item => (
                <Pressable
                  key={(item.id ?? 0) + "_" + item.name}
                  onPress={() => { setMealPickerItem(item); setMealPickerPage("item"); }}
                  style={({ pressed }) => ({ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 8, opacity: pressed ? 0.7 : 1 })}
                >
                  {item.brand && <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#aaaaaa", letterSpacing: 0.6, marginBottom: 2 }}>{item.brand.toUpperCase()}</Text>}
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{item.name}</Text>
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>{item.calories} kcal · P {item.proteinG}g · C {item.carbsG}g · F {item.fatG}g</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* ── PAGE: Servings for selected ingredient ── */}
          {mealPickerPage === "item" && mealPickerItem && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View style={{ backgroundColor: card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: border, marginBottom: 20 }}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: text }}>{mealPickerItem.name}</Text>
                {mealPickerItem.brand && <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>{mealPickerItem.brand}</Text>}
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginTop: 4 }}>
                  Per serving: {mealPickerItem.calories} kcal · {mealPickerItem.proteinG}g protein
                </Text>
              </View>

              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>SERVINGS</Text>
              <TextInput
                value={mealPickerServings}
                onChangeText={setMealPickerServings}
                keyboardType="decimal-pad"
                style={{ backgroundColor: card, borderRadius: 12, padding: 14, color: text, fontFamily: "Manrope-ExtraBold", fontSize: 24, borderWidth: 1, borderColor: border, textAlign: "center", marginBottom: 24 }}
              />

              <Pressable
                onPress={addIngredientToMeal}
                style={({ pressed }) => ({ backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                  Add Ingredient
                </Text>
              </Pressable>
            </ScrollView>
          )}

        </View>
      </Modal>

      {/* ── Add Food Modal ── */}
      {/* NOTE: rendered AFTER Create Meal so it gets higher z-index on RN Web */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg }}>

          {/* Header */}
          <View style={{ padding: 20, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: border }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: text }}>
              Add Food
            </Text>
            <Pressable onPress={closeAddModal} hitSlop={8}>
              <X size={22} color={text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">

            {/* ── HOME view: meal picker + action buttons ── */}
            {addView === "home" && !selectedItem && (
              <>
                {/* Meal selector */}
                <View style={{ marginBottom: 20 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>MEAL</Text>
                    <Pressable
                      onPress={() => setShowMealPicker(p => !p)}
                      style={{ backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                    >
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 16, color: text }}>{MEAL_LABELS[activeMeal]}</Text>
                      <ChevronDown size={18} color={muted} />
                    </Pressable>
                    {showMealPicker && (
                      <View style={{ backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, marginTop: 4, overflow: "hidden" }}>
                        {MEALS.map((m, i) => (
                          <Pressable
                            key={m}
                            onPress={() => { setActiveMeal(m); setShowMealPicker(false); }}
                            style={({ pressed }) => ({
                              paddingHorizontal: 16, paddingVertical: 13,
                              borderTopWidth: i > 0 ? 1 : 0, borderTopColor: border,
                              backgroundColor: activeMeal === m ? `${accentActive}18` : "transparent",
                              opacity: pressed ? 0.7 : 1,
                            })}
                          >
                            <Text style={{ fontFamily: activeMeal === m ? "Manrope-Bold" : "Manrope", fontSize: 15, color: activeMeal === m ? accentActive : text }}>
                              {MEAL_LABELS[m]}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                {/* Barcode + Scan Label buttons */}
                <View style={{ flexDirection: "row", gap: 12, marginBottom: scanLabelError ? 8 : 24 }}>
                  <Pressable
                    onPress={() => setAddView("barcode")}
                    style={({ pressed }) => ({
                      flex: 1, backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border,
                      paddingVertical: 20, alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <ScanLine size={26} color={text} />
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>Barcode</Text>
                  </Pressable>
                  <Pressable
                    onPress={openScanLabel}
                    disabled={scanLabelLoading}
                    style={({ pressed }) => ({
                      flex: 1, backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border,
                      paddingVertical: 20, alignItems: "center", gap: 8, opacity: (pressed || scanLabelLoading) ? 0.7 : 1,
                    })}
                  >
                    {scanLabelLoading
                      ? <ActivityIndicator size="small" color={accentActive} />
                      : <Camera size={26} color={text} />
                    }
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>
                      {scanLabelLoading ? "Reading…" : "Scan Label"}
                    </Text>
                  </Pressable>
                </View>

                {/* Scan label feedback */}
                {scanLabelLoading && (
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, textAlign: "center", marginBottom: 16 }}>
                    Claude is reading the nutrition label…
                  </Text>
                )}
                {scanLabelError ? (
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#ef4444", textAlign: "center", marginBottom: 16 }}>
                    {scanLabelError}
                  </Text>
                ) : null}

                {/* OR SEARCH divider */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 1 }}>OR SEARCH</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                </View>

                {/* Search input (tappable, goes to search view) */}
                <Pressable
                  onPress={() => setAddView("search")}
                  style={{ flexDirection: "row", alignItems: "center", backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingHorizontal: 14, paddingVertical: 14, gap: 10, marginBottom: 16 }}
                >
                  <Search size={18} color={muted} />
                  <Text style={{ flex: 1, fontFamily: "Manrope", fontSize: 15, color: muted }}>Search food…</Text>
                </Pressable>

                {/* Manual entry */}
                <Pressable
                  onPress={() => setAddView("manual")}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, opacity: pressed ? 0.6 : 1 })}
                >
                  <PenLine size={16} color={muted} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted }}>Manual entry</Text>
                </Pressable>
              </>
            )}

            {/* ── SEARCH view ── */}
            {addView === "search" && !selectedItem && (
              <>
                <Pressable onPress={() => { setAddView("home"); setSearchQuery(""); setSearchResults([]); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 }}>
                  <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>Back</Text>
                </Pressable>

                {/* Search bar */}
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 10 }}>
                  {searching
                    ? <ActivityIndicator size="small" color={muted} style={{ width: 18 }} />
                    : <Search size={18} color={muted} />
                  }
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search food, restaurant, or brand…"
                    placeholderTextColor={muted}
                    returnKeyType="search"
                    autoFocus
                    style={{ flex: 1, color: text, fontFamily: "Manrope", fontSize: 15, padding: 0 }}
                  />
                  {searchQuery.length > 0 && (
                    <Pressable onPress={() => { setSearchQuery(""); setSearchResults([]); }} hitSlop={8}>
                      <X size={16} color={muted} />
                    </Pressable>
                  )}
                </View>

                {/* Filter toggle */}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                  {(["all", "restaurant"] as const).map(f => (
                    <Pressable key={f} onPress={() => setSearchFilter(f)}
                      style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: searchFilter === f ? accentActive : card, borderWidth: 1, borderColor: searchFilter === f ? accentActive : border }}>
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: searchFilter === f ? (isWhite ? "#fff" : palette.accentText) : muted }}>
                        {f === "all" ? "All Foods" : "Restaurants"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Popular restaurants */}
                {searchQuery.length < 2 && (
                  <View style={{ marginBottom: 18 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 10 }}>POPULAR RESTAURANTS</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {["McDonald's","Chipotle","Starbucks","Chick-fil-A","Subway","Taco Bell","Panera","Wendy's","Domino's","Olive Garden","Shake Shack","Five Guys"].map(r => (
                        <Pressable key={r} onPress={() => { setSearchFilter("restaurant"); setSearchQuery(r); }}
                          style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: card, borderWidth: 1, borderColor: border, opacity: pressed ? 0.7 : 1 })}>
                          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: text }}>{r}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, textAlign: "center", marginTop: 10 }}>No results found</Text>
                )}

                {searchResults.map(item => (
                  <Pressable key={(item.id ?? 0) + "_" + item.name} onPress={() => setSelectedItem(item)}
                    style={({ pressed }) => ({ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 8, opacity: pressed ? 0.7 : 1 })}>
                    {item.brand && <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#aaaaaa", letterSpacing: 0.6, marginBottom: 2 }}>{item.brand.toUpperCase()}</Text>}
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{item.name}</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>{item.calories} kcal · P {item.proteinG}g · C {item.carbsG}g · F {item.fatG}g</Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* ── MANUAL ENTRY view ── */}
            {addView === "manual" && !selectedItem && (
              <>
                <Pressable onPress={() => setAddView("home")} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 18 }}>
                  <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>Back</Text>
                </Pressable>

                {[
                  { label: "FOOD NAME", value: manualName, set: setManualName, placeholder: "e.g. Chicken breast", keyboard: "default" as const },
                  { label: "CALORIES", value: manualCals, set: setManualCals, placeholder: "0", keyboard: "decimal-pad" as const },
                  { label: "PROTEIN (g)", value: manualProtein, set: setManualProtein, placeholder: "0", keyboard: "decimal-pad" as const },
                  { label: "CARBS (g)", value: manualCarbs, set: setManualCarbs, placeholder: "0", keyboard: "decimal-pad" as const },
                  { label: "FAT (g)", value: manualFat, set: setManualFat, placeholder: "0", keyboard: "decimal-pad" as const },
                ].map(f => (
                  <View key={f.label} style={{ marginBottom: 14 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>{f.label}</Text>
                    <TextInput
                      value={f.value} onChangeText={f.set}
                      placeholder={f.placeholder} placeholderTextColor={muted}
                      keyboardType={f.keyboard}
                      style={{ backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 15, color: text }}
                    />
                  </View>
                ))}

                {/* Time override */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>TIME</Text>
                  <TextInput
                    value={logTime} onChangeText={setLogTime}
                    placeholder="8:30 AM" placeholderTextColor={muted}
                    keyboardType="numbers-and-punctuation"
                    style={{ backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 15, color: text }}
                  />
                </View>

                <Pressable
                  onPress={addManualToLog}
                  disabled={addEntry.isPending || !manualName.trim()}
                  style={({ pressed }) => ({ backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 8, opacity: (pressed || addEntry.isPending || !manualName.trim()) ? 0.6 : 1 })}
                >
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                    {addEntry.isPending ? "Adding…" : `Add to ${MEAL_LABELS[activeMeal]}`}
                  </Text>
                </Pressable>
              </>
            )}

            {/* ── BARCODE view ── */}
            {addView === "barcode" && !selectedItem && (
              <>
                <Pressable onPress={() => { setAddView("home"); setBarcodeError(""); setBarcodeManualCode(""); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 18 }}>
                  <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>Back</Text>
                </Pressable>

                {barcodeLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 48 }}>
                    <ActivityIndicator size="large" color={accentActive} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, marginTop: 14 }}>
                      Looking up product…
                    </Text>
                  </View>
                ) : (
                  <>
                    {/* Photo capture button */}
                    <Pressable
                      onPress={openBarcodeCapture}
                      style={({ pressed }) => ({
                        backgroundColor: accentActive, borderRadius: 16, paddingVertical: 18,
                        flexDirection: "row", alignItems: "center", justifyContent: "center",
                        gap: 10, marginBottom: 10, opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <ScanLine size={22} color={isWhite ? "#fff" : palette.accentText} />
                      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                        Take Photo of Barcode
                      </Text>
                    </Pressable>
                    <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, textAlign: "center", marginBottom: 24 }}>
                      Point your camera at the barcode on the product
                    </Text>

                    {barcodeError ? (
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#ef4444", textAlign: "center", marginBottom: 16 }}>
                        {barcodeError}
                      </Text>
                    ) : null}

                    {/* Divider */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 1 }}>OR ENTER CODE</Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                    </View>

                    {/* Manual barcode entry */}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TextInput
                        value={barcodeManualCode}
                        onChangeText={setBarcodeManualCode}
                        placeholder="e.g. 0123456789012"
                        placeholderTextColor={muted}
                        keyboardType="number-pad"
                        returnKeyType="search"
                        onSubmitEditing={() => lookupBarcodeCode(barcodeManualCode)}
                        style={{ flex: 1, backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 15, color: text }}
                      />
                      <Pressable
                        onPress={() => lookupBarcodeCode(barcodeManualCode)}
                        disabled={!barcodeManualCode.trim()}
                        style={({ pressed }) => ({
                          backgroundColor: accentActive, borderRadius: 12, paddingHorizontal: 18,
                          justifyContent: "center",
                          opacity: (!barcodeManualCode.trim() || pressed) ? 0.4 : 1,
                        })}
                      >
                        <Search size={20} color={isWhite ? "#fff" : palette.accentText} />
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            )}

            {/* ── Serving selector (after item picked from search / barcode / scan) ── */}
            {selectedItem && (
              <>
                <View style={{ backgroundColor: card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: border, marginBottom: 20 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: text }}>{selectedItem.name}</Text>
                  {selectedItem.brand && <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>{selectedItem.brand}</Text>}
                  <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginTop: 4 }}>
                    Per serving: {selectedItem.calories} kcal · {selectedItem.proteinG}g protein
                  </Text>
                </View>

                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>SERVINGS</Text>
                <TextInput
                  value={servings}
                  onChangeText={setServings}
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: card, borderRadius: 12, padding: 14, color: text, fontFamily: "Manrope-ExtraBold", fontSize: 24, borderWidth: 1, borderColor: border, textAlign: "center", marginBottom: 14 }}
                />

                <View style={{ marginBottom: 20 }}>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>TIME</Text>
                  <TextInput
                    value={logTime} onChangeText={setLogTime}
                    placeholder="8:30 AM" placeholderTextColor={muted}
                    keyboardType="numbers-and-punctuation"
                    style={{ backgroundColor: card, borderRadius: 12, padding: 14, color: text, fontFamily: "Manrope-Bold", fontSize: 18, borderWidth: 1, borderColor: border, textAlign: "center" }}
                  />
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable onPress={() => setSelectedItem(null)} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: border, alignItems: "center" }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>Back</Text>
                  </Pressable>
                  <Pressable
                    onPress={addToLog}
                    disabled={addEntry.isPending}
                    style={({ pressed }) => ({ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: accentActive, alignItems: "center", opacity: (pressed || addEntry.isPending) ? 0.7 : 1 })}
                  >
                    <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 14, color: isWhite ? "#fff" : palette.accentText }}>
                      {addEntry.isPending ? "Adding…" : `Add to ${MEAL_LABELS[activeMeal]}`}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

          </ScrollView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}
