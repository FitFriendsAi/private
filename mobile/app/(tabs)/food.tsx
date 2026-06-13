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
import { todayStr, nowTimeStr, timeStrToISO, fmtTime, shiftDateStr, formatDate } from "@/lib/utils";
import { Plus, Minus, Search, X, ChevronRight, UtensilsCrossed, Trash2, ScanLine, Camera, PenLine, ChevronDown, ChevronLeft, Sparkles } from "lucide-react-native";

/** A food line-item estimated by Claude from text or a photo (macros are TOTALS for the amount eaten). */
type ParsedMealItem = {
  name: string;
  brand?: string;
  quantity: string;
  servingSizeG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
};
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
  mealGroupId?: number | null;
  mealGroupName?: string | null;
}

// Groups food log entries so that items logged together from a saved meal
// appear as a single collapsible card instead of individual rows.
type LogDisplayRow =
  | { kind: "group"; groupId: number; groupName: string; entries: FoodLogEntry[] }
  | { kind: "entry"; entry: FoodLogEntry };

function groupLogEntries(entries: FoodLogEntry[]): LogDisplayRow[] {
  const rows: LogDisplayRow[] = [];
  const seen = new Map<number, LogDisplayRow & { kind: "group" }>();
  for (const entry of entries) {
    if (entry.mealGroupId != null) {
      let g = seen.get(entry.mealGroupId);
      if (!g) {
        g = { kind: "group", groupId: entry.mealGroupId, groupName: entry.mealGroupName ?? "Meal", entries: [] };
        seen.set(entry.mealGroupId, g);
        rows.push(g);
      }
      g.entries.push(entry);
    } else {
      rows.push({ kind: "entry", entry });
    }
  }
  return rows;
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

  // ── Selected day for the food log (defaults to today, can navigate to past days) ──
  const [selectedDate, setSelectedDate] = useState(today);

  // ── Tab: "log" | "meals" ──
  const [tab, setTab] = useState<"log" | "meals">("log");

  // ── Add food modal ──
  const [showAdd, setShowAdd]               = useState(false);
  const [activeMeal, setActiveMeal]         = useState<MealType>("breakfast");
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState<FoodItem[]>([]);
  const [searching, setSearching]           = useState(false);
  const [selectedItem, setSelectedItem]     = useState<FoodItem | null>(null);
  const [creatingItem, setCreatingItem]     = useState(false);
  const [servings, setServings]             = useState("1");
  const [logTime, setLogTime]               = useState(nowTimeStr);
  // ── Create / edit meal modal ──
  const [showCreateMeal, setShowCreateMeal]         = useState(false);
  const [editingMeal, setEditingMeal]               = useState<SavedMeal | null>(null);
  const [newMealName, setNewMealName]               = useState("");
  const [newMealDesc, setNewMealDesc]               = useState("");
  const [newMealIngredients, setNewMealIngredients] = useState<
    { foodItem: FoodItem; servings: number }[]
  >([]);

  // ── Ingredient picker embedded inside Create Meal modal ──
  const [mealPickerPage, setMealPickerPage]         = useState<"search" | "item" | "barcode" | null>(null);
  const [mealPickerQuery, setMealPickerQuery]       = useState("");
  const [mealPickerResults, setMealPickerResults]   = useState<FoodItem[]>([]);
  const [mealPickerSearching, setMealPickerSearching] = useState(false);
  const [mealPickerItem, setMealPickerItem]         = useState<FoodItem | null>(null);
  const [mealPickerAddingItem, setMealPickerAddingItem] = useState(false);
  const [mealPickerServings, setMealPickerServings] = useState("1");
  const [mealPickerBarcodeLoading, setMealPickerBarcodeLoading]     = useState(false);
  const [mealPickerBarcodeError, setMealPickerBarcodeError]         = useState("");
  const [mealPickerBarcodeManualCode, setMealPickerBarcodeManualCode] = useState("");
  const [mealPickerScanLabelLoading, setMealPickerScanLabelLoading] = useState(false);
  const [mealPickerScanLabelError, setMealPickerScanLabelError]     = useState("");

  // ── Food detail modal ──
  const [detailEntry, setDetailEntry]     = useState<FoodLogEntry | null>(null);
  const [detailItem,  setDetailItem]      = useState<FoodItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editServings, setEditServings]   = useState("1");

  async function openDetail(entry: FoodLogEntry) {
    setDetailEntry(entry);
    setDetailItem(null);
    setEditServings(String(entry.servings));
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
    queryKey: ["/api/food-log", selectedDate],
    queryFn:  () => apiRequest("GET", `/api/food-log?date=${selectedDate}`),
  });
  const { data: targets } = useQuery<any>({
    queryKey: ["/api/targets"],
    queryFn:  () => apiRequest("GET", "/api/targets"),
  });
  const { data: savedMeals = [] } = useQuery<SavedMeal[]>({
    queryKey: ["/api/meals"],
    queryFn:  () => apiRequest("GET", "/api/meals"),
  });
  const { data: recentFoods = [] } = useQuery<FoodItem[]>({
    queryKey: ["/api/food/recent"],
    queryFn:  () => apiRequest("GET", "/api/food/recent"),
  });

  // ── Mutations ──
  const addEntry = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/food-log", data),
    onSuccess: (_res, data) => {
      qc.invalidateQueries({ queryKey: ["/api/food-log", selectedDate] });
      // Write nutrition to Apple Health silently (only for today's entries —
      // Health writes use the current timestamp, so backdated entries would be misattributed)
      if (health.authorized && selectedDate === today) {
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
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/food-log", selectedDate] }),
  });

  const updateEntry = useMutation({
    mutationFn: ({ id, ...body }: any) => apiRequest<FoodLogEntry>("PATCH", `/api/food-log/${id}`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/food-log", selectedDate] }),
  });

  const logMeal = useMutation({
    mutationFn: ({ mealId, mealType }: { mealId: number; mealType: MealType }) =>
      apiRequest("POST", `/api/meals/${mealId}/log`, { date: selectedDate, mealType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/food-log", selectedDate] });
      setTab("log");
    },
  });

  const createMeal = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/meals", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/meals"] });
      closeMealModal();
    },
  });

  const updateMeal = useMutation({
    mutationFn: ({ id, ...body }: any) => apiRequest("PATCH", `/api/meals/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/meals"] });
      closeMealModal();
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


  // ── Add food modal view: "home" | "search" | "manual" | "barcode" | "describe" ──
  const [addView, setAddView] = useState<"home" | "search" | "manual" | "barcode" | "describe">("home");
  const [showMealPicker, setShowMealPicker] = useState(false);

  // ── AI meal logging (natural-language + plate photo) ──────────────────────
  const [mealText, setMealText]         = useState("");
  const [parsing, setParsing]           = useState(false);
  const [parseError, setParseError]     = useState("");
  const [parsedItems, setParsedItems]   = useState<ParsedMealItem[] | null>(null);
  const [loggingQuick, setLoggingQuick] = useState(false);

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
  const [manualShowExtra, setManualShowExtra] = useState(false);
  const [manualFiber, setManualFiber]       = useState("");
  const [manualSugar, setManualSugar]       = useState("");
  const [manualSodium, setManualSodium]     = useState("");
  const [manualSatFat, setManualSatFat]     = useState("");
  const [manualTransFat, setManualTransFat] = useState("");
  const [manualCholesterol, setManualCholesterol] = useState("");
  const [manualPotassium, setManualPotassium]     = useState("");

  function resetAddModal() {
    setAddView("home");
    setShowMealPicker(false);
    setManualName(""); setManualCals(""); setManualProtein(""); setManualCarbs(""); setManualFat("");
    setManualShowExtra(false);
    setManualFiber(""); setManualSugar(""); setManualSodium(""); setManualSatFat("");
    setManualTransFat(""); setManualCholesterol(""); setManualPotassium("");
    setBarcodeError(""); setBarcodeManualCode(""); setBarcodeLoading(false);
    setScanLabelError(""); setScanLabelLoading(false);
    setMealText(""); setParsing(false); setParseError(""); setParsedItems(null); setLoggingQuick(false);
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
    setMealPickerBarcodeLoading(false);
    setMealPickerBarcodeError("");
    setMealPickerBarcodeManualCode("");
    setMealPickerScanLabelLoading(false);
    setMealPickerScanLabelError("");
  }

  function closeMealModal() {
    setShowCreateMeal(false);
    setEditingMeal(null);
    setNewMealName("");
    setNewMealDesc("");
    setNewMealIngredients([]);
    closeMealPicker();
  }

  function openEditMeal(meal: SavedMeal) {
    setEditingMeal(meal);
    setNewMealName(meal.name);
    setNewMealDesc(meal.description ?? "");
    // Reconstruct per-serving FoodItem from the stored actuals so the existing
    // ingredient list UI (which expects { foodItem, servings }) works as-is.
    setNewMealIngredients(meal.ingredients.map(ing => {
      const sv = ing.servings || 1;
      return {
        foodItem: {
          id: ing.foodItemId ?? 0,
          name: ing.foodName,
          calories: ing.caloriesActual / sv,
          proteinG: ing.proteinActual / sv,
          carbsG:   ing.carbsActual   / sv,
          fatG:     ing.fatActual     / sv,
          servingSizeG: 0,
        } as FoodItem,
        servings: sv,
      };
    }));
    closeMealPicker();
    setShowCreateMeal(true);
  }

  async function addIngredientToMeal() {
    if (!mealPickerItem) return;
    const sv = parseFloat(mealPickerServings) || 1;

    setMealPickerAddingItem(true);
    const foodItemId = await ensureFoodItemId(mealPickerItem);
    setMealPickerAddingItem(false);

    const foodItem = foodItemId ? { ...mealPickerItem, id: foodItemId } : mealPickerItem;
    setNewMealIngredients(prev => [...prev, { foodItem, servings: sv }]);
    // Stay on the search page (cleared) so the user can immediately add another ingredient.
    // They tap "Done" in the header to return to the main form.
    setMealPickerItem(null);
    setMealPickerServings("1");
    setMealPickerQuery("");
    setMealPickerResults([]);
    setMealPickerPage("search");
  }

  // ── Meal picker barcode / scan-label variants ─────────────────────────────
  async function mealLookupBarcodeCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setMealPickerBarcodeLoading(true);
    setMealPickerBarcodeError("");
    try {
      const item = await apiRequest<FoodItem>("GET", `/api/food/barcode/${encodeURIComponent(trimmed)}`);
      setMealPickerItem(item);
      setMealPickerPage("item");
    } catch {
      setMealPickerBarcodeError("Product not found. Try a different barcode or search by name.");
    } finally {
      setMealPickerBarcodeLoading(false);
    }
  }

  function mealOpenBarcodeCapture() {
    if (Platform.OS !== "web") return;
    const input = createCameraInput();
    input.onchange = async (e: Event) => {
      document.body.removeChild(input);
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setMealPickerBarcodeLoading(true);
      setMealPickerBarcodeError("");
      const objectUrl = URL.createObjectURL(file);
      try {
        if ("BarcodeDetector" in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "qr_code", "data_matrix", "itf"],
          });
          const bitmap = await createImageBitmap(file);
          const barcodes = await detector.detect(bitmap);
          URL.revokeObjectURL(objectUrl);
          if (barcodes.length > 0) { await mealLookupBarcodeCode(barcodes[0].rawValue); return; }
        }
        const canvas = await resizeImageToCanvas(objectUrl, 1400);
        URL.revokeObjectURL(objectUrl);
        const reader = new BrowserMultiFormatReader();
        const result = reader.decodeFromCanvas(canvas);
        await mealLookupBarcodeCode(result.getText());
      } catch (err: any) {
        URL.revokeObjectURL(objectUrl);
        const isNotFound = err?.name === "NotFoundException" || String(err).includes("No MultiFormat");
        setMealPickerBarcodeError(
          isNotFound
            ? "No barcode found. Try a clearer/closer photo or type the number below."
            : "Couldn't read the photo. Try again or type the number below."
        );
        setMealPickerBarcodeLoading(false);
      }
    };
    input.click();
  }

  function mealOpenScanLabel() {
    if (Platform.OS !== "web") return;
    const input = createCameraInput();
    input.onchange = async (e: Event) => {
      document.body.removeChild(input);
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setMealPickerScanLabelLoading(true);
      setMealPickerScanLabelError("");
      try {
        const { base64, mediaType } = await resizeFileForUpload(file, 1600, 0.85);
        const data = await apiRequest<any>("POST", "/api/food/scan-label", { imageBase64: base64, mediaType }, 45_000);
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
        setMealPickerItem(item);
        setMealPickerPage("item");
      } catch {
        setMealPickerScanLabelError("Couldn't read the label. Try a clearer, well-lit photo.");
      } finally {
        setMealPickerScanLabelLoading(false);
      }
    };
    input.click();
  }

  // Search results from external sources (USDA/FatSecret/OFF/CalorieNinjas) have no
  // food_items.id yet — persist them first so log entries / meal ingredients can link
  // to full nutrition (fiber, sodium, sugar, etc.) instead of just the 4 basic macros.
  async function ensureFoodItemId(item: FoodItem): Promise<number | undefined> {
    if (item.id) return item.id;
    try {
      const created = await apiRequest<FoodItem>("POST", "/api/food/items", {
        name: item.name,
        brand: item.brand || undefined,
        servingSizeG: item.servingSizeG || 100,
        servingUnit: item.servingUnit || "serving",
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        fiberG: item.fiberG,
        sodiumMg: item.sodiumMg,
        sugarG: item.sugarG,
        saturatedFatG: item.saturatedFatG,
        transFatG: item.transFatG,
        cholesterolMg: item.cholesterolMg,
        potassiumMg: item.potassiumMg,
        calciumMg: item.calciumMg,
        ironMg: item.ironMg,
        vitaminDMcg: item.vitaminDMcg,
        vitaminCMg: item.vitaminCMg,
        source: item.source || "search",
      });
      return created.id;
    } catch {
      return undefined;
    }
  }

  async function addToLog() {
    if (!selectedItem) return;
    const sv = parseFloat(servings) || 1;

    setCreatingItem(true);
    const foodItemId = await ensureFoodItemId(selectedItem);
    setCreatingItem(false);

    addEntry.mutate({
      date: selectedDate,
      mealType: activeMeal,
      foodItemId,
      foodName: selectedItem.name,
      servings: sv,
      caloriesActual: Math.round(selectedItem.calories * sv),
      proteinActual:  Math.round(selectedItem.proteinG * sv * 10) / 10,
      carbsActual:    Math.round(selectedItem.carbsG   * sv * 10) / 10,
      fatActual:      Math.round(selectedItem.fatG     * sv * 10) / 10,
      loggedAt: timeStrToISO(logTime, selectedDate),
    });
  }


  function saveMeal() {
    if (!newMealName.trim() || newMealIngredients.length === 0) {
      Alert.alert("Add a name and at least one ingredient");
      return;
    }
    const payload = {
      name: newMealName,
      description: newMealDesc || undefined,
      ingredients: newMealIngredients.map(({ foodItem, servings: sv }) => ({
        foodItemId: foodItem.id || undefined,
        foodName: foodItem.name,
        servings: sv,
        caloriesActual: Math.round(foodItem.calories * sv),
        proteinActual:  Math.round(foodItem.proteinG * sv * 10) / 10,
        carbsActual:    Math.round(foodItem.carbsG   * sv * 10) / 10,
        fatActual:      Math.round(foodItem.fatG     * sv * 10) / 10,
      })),
    };
    if (editingMeal) {
      updateMeal.mutate({ id: editingMeal.id, ...payload });
    } else {
      createMeal.mutate(payload);
    }
  }

  // Scale a logged entry's macros to a new serving amount and persist it.
  function saveServings() {
    const e = detailEntry;
    if (!e) return;
    const newSv = parseFloat(editServings);
    if (!newSv || newSv <= 0 || Math.abs(newSv - e.servings) < 0.001) return;
    const ratio = e.servings > 0 ? newSv / e.servings : 1;
    updateEntry.mutate(
      {
        id: e.id,
        servings: newSv,
        caloriesActual: Math.round(e.caloriesActual * ratio),
        proteinActual:  Math.round(e.proteinActual * ratio * 10) / 10,
        carbsActual:    Math.round(e.carbsActual   * ratio * 10) / 10,
        fatActual:      Math.round(e.fatActual     * ratio * 10) / 10,
      },
      { onSuccess: (updated) => setDetailEntry(updated) }
    );
  }

  async function addManualToLog() {
    if (!manualName.trim()) return Alert.alert("Enter a food name");
    const cals = parseFloat(manualCals) || 0;
    const sv = parseFloat(servings) || 1;
    const proteinG = parseFloat(manualProtein) || 0;
    const carbsG   = parseFloat(manualCarbs)   || 0;
    const fatG     = parseFloat(manualFat)     || 0;

    // Save as a custom food_items entry so it shows up in "My Foods" / search
    // for next time, and so the detail view can show fiber/sodium/sugar/etc.
    const extra = {
      fiberG:         parseFloat(manualFiber)       || undefined,
      sugarG:         parseFloat(manualSugar)       || undefined,
      sodiumMg:       parseFloat(manualSodium)      || undefined,
      saturatedFatG:  parseFloat(manualSatFat)      || undefined,
      transFatG:      parseFloat(manualTransFat)    || undefined,
      cholesterolMg:  parseFloat(manualCholesterol) || undefined,
      potassiumMg:    parseFloat(manualPotassium)   || undefined,
    };
    let foodItemId: number | undefined;
    try {
      setCreatingItem(true);
      const item = await apiRequest<FoodItem>("POST", "/api/food/items", {
        name: manualName.trim(),
        servingSizeG: 1,
        servingUnit: "serving",
        calories: cals / sv,
        proteinG: proteinG / sv,
        carbsG:   carbsG   / sv,
        fatG:     fatG     / sv,
        ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v != null ? v / sv : v])),
        source: "custom",
      });
      foodItemId = item.id;
    } catch {
      // fall back to logging without a linked food item
    } finally {
      setCreatingItem(false);
    }

    addEntry.mutate({
      date: selectedDate, mealType: activeMeal,
      foodItemId,
      foodName: manualName.trim(), servings: sv,
      caloriesActual: cals,
      proteinActual: proteinG,
      carbsActual:   carbsG,
      fatActual:     fatG,
      loggedAt: timeStrToISO(logTime, selectedDate),
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

  /** Resize a blob/file URL to max maxPx on its longest side and return a canvas.
   *  Returning the canvas lets us call decodeFromCanvas() directly, which is
   *  synchronous and avoids ZXing's unreliable image-reload path. */
  function resizeImageToCanvas(objectUrl: string, maxPx = 1400): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round((img.naturalWidth  || img.width)  * scale);
        canvas.height = Math.round((img.naturalHeight || img.height) * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = objectUrl;
    });
  }

  /** Create a hidden file input, attach it to the DOM (required for iOS change event),
   *  and trigger a click. Returns the input so the caller can set onchange. */
  function createCameraInput(accept = "image/*"): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.setAttribute("capture", "environment");
    input.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(input); // must be in DOM or iOS won't fire change event
    return input;
  }

  /** Resize a File to max maxPx JPEG and return { base64, mediaType }. */
  function resizeFileForUpload(file: File, maxPx = 1600, quality = 0.85): Promise<{ base64: string; mediaType: string }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round((img.naturalWidth  || img.width)  * scale);
        canvas.height = Math.round((img.naturalHeight || img.height) * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ── Open camera to photograph a barcode (web only) ────────────────────────
  function openBarcodeCapture() {
    if (Platform.OS !== "web") return;
    const input = createCameraInput();
    input.onchange = async (e: Event) => {
      document.body.removeChild(input);
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
          URL.revokeObjectURL(objectUrl);
          if (barcodes.length > 0) {
            await lookupBarcodeCode(barcodes[0].rawValue);
            return;
          }
          // Native detector found nothing — fall through to ZXing
        }

        // ② ZXing — works on iOS Safari, Firefox, and older Chrome.
        // Resize first: full-res iPhone photos (12MP+) crash the canvas decode.
        // decodeFromCanvas is synchronous and skips ZXing's image-reload path.
        const canvas = await resizeImageToCanvas(objectUrl, 1400);
        URL.revokeObjectURL(objectUrl);
        const reader = new BrowserMultiFormatReader();
        const result = reader.decodeFromCanvas(canvas);
        await lookupBarcodeCode(result.getText());
      } catch (err: any) {
        URL.revokeObjectURL(objectUrl);
        const isNotFound = err?.name === "NotFoundException" || String(err).includes("No MultiFormat");
        setBarcodeError(
          isNotFound
            ? "No barcode found. Try a clearer/closer photo or type the number below."
            : "Couldn't read the photo. Try again or type the number below."
        );
      } finally {
        setBarcodeLoading(false);
      }
    };
    input.click();
  }

  // ── Open camera to photograph a nutrition label (web only) ────────────────
  function openScanLabel() {
    if (Platform.OS !== "web") return;
    const input = createCameraInput();
    input.onchange = async (e: Event) => {
      document.body.removeChild(input);
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setScanLabelLoading(true);
      setScanLabelError("");
      try {
        // Resize before sending — full-res iPhone photos (8–15 MB) exceed Claude's limit
        const { base64, mediaType } = await resizeFileForUpload(file, 1600, 0.85);
        // Claude Vision extracts nutrition facts — give it more time than the default 10s
        const data = await apiRequest<any>("POST", "/api/food/scan-label", { imageBase64: base64, mediaType }, 45_000);
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
        setSelectedItem(item);
      } catch {
        setScanLabelError("Couldn't read the label. Try a clearer, well-lit photo.");
      } finally {
        setScanLabelLoading(false);
      }
    };
    input.click();
  }

  // ── AI meal logging ─────────────────────────────────────────────────────────
  // Parse a free-text meal description into individual food items with macros.
  async function parseMealDescription() {
    const text = mealText.trim();
    if (!text) return;
    setParsing(true);
    setParseError("");
    setParsedItems(null);
    try {
      const res = await apiRequest<{ items: ParsedMealItem[] }>("POST", "/api/food/parse-text", { text }, 45_000);
      if (!res.items?.length) {
        setParseError("Couldn't identify any foods. Try describing amounts, e.g. “2 eggs, 1 cup rice”.");
      } else {
        setParsedItems(res.items);
      }
    } catch {
      setParseError("Couldn't estimate that meal. Please try again.");
    } finally {
      setParsing(false);
    }
  }

  // Photograph a plated meal → estimated food items (web only).
  function openSnapMeal() {
    if (Platform.OS !== "web") return;
    const input = createCameraInput();
    input.onchange = async (e: Event) => {
      document.body.removeChild(input);
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setParsing(true);
      setParseError("");
      setParsedItems(null);
      try {
        const { base64, mediaType } = await resizeFileForUpload(file, 1600, 0.85);
        const res = await apiRequest<{ items: ParsedMealItem[] }>("POST", "/api/food/parse-photo", { imageBase64: base64, mediaType }, 45_000);
        if (!res.items?.length) {
          setParseError("Couldn't identify any foods in that photo. Try a clearer, well-lit shot.");
        } else {
          setParsedItems(res.items);
        }
      } catch {
        setParseError("Couldn't read that photo. Try again.");
      } finally {
        setParsing(false);
      }
    };
    input.click();
  }

  // Log the reviewed AI items to the current meal/date in one batch.
  async function confirmQuickLog() {
    const items = parsedItems ?? [];
    if (items.length === 0) return;
    setLoggingQuick(true);
    try {
      await apiRequest("POST", "/api/food-log/quick", { date: selectedDate, mealType: activeMeal, items }, 45_000);
      qc.invalidateQueries({ queryKey: ["/api/food-log", selectedDate] });
      qc.invalidateQueries({ queryKey: ["/api/food/recent"] });
      // Mirror manual logging: write totals to Apple Health for today only
      if (health.authorized && selectedDate === today) {
        const total = items.reduce(
          (s, it) => ({
            calories: s.calories + Math.round(it.calories || 0),
            proteinG: s.proteinG + Math.round(it.proteinG || 0),
            carbsG:   s.carbsG   + Math.round(it.carbsG   || 0),
            fatG:     s.fatG     + Math.round(it.fatG     || 0),
          }),
          { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        );
        const mealType =
          activeMeal === "breakfast" ? "Breakfast" :
          activeMeal === "lunch"     ? "Lunch"     :
          activeMeal === "dinner"    ? "Dinner"    : "Snack";
        health.writeFood({ mealName: mealType, mealType, ...total });
      }
      closeAddModal();
    } catch {
      setParseError("Couldn't save those items. Please try again.");
    } finally {
      setLoggingQuick(false);
    }
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <Pressable
                onPress={() => setSelectedDate(d => shiftDateStr(d, -1))}
                hitSlop={8}
                style={({ pressed }) => ({ padding: 2, opacity: pressed ? 0.6 : 1 })}
              >
                <ChevronLeft size={16} color={muted} />
              </Pressable>
              <Text style={{ fontSize: 13, fontFamily: "Manrope", color: muted }}>
                {selectedDate === today ? "Today" : formatDate(selectedDate)}
              </Text>
              <Pressable
                onPress={() => setSelectedDate(d => shiftDateStr(d, 1))}
                disabled={selectedDate >= today}
                hitSlop={8}
                style={({ pressed }) => ({ padding: 2, opacity: selectedDate >= today ? 0.25 : pressed ? 0.6 : 1 })}
              >
                <ChevronRight size={16} color={muted} />
              </Pressable>
            </View>
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
            <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: "#888888", letterSpacing: 0.8, marginBottom: 4 }}>
              EATEN · {selectedDate === today ? "TODAY" : formatDate(selectedDate).toUpperCase()}
            </Text>
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
                {t === "log" ? (selectedDate === today ? "Today's Log" : `${formatDate(selectedDate)} Log`) : "Saved Meals"}
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
              {groupLogEntries(entries).map((row, rowIdx) => {
                if (row.kind === "group") {
                  const gCals    = Math.round(row.entries.reduce((s, e) => s + e.caloriesActual, 0));
                  const gProtein = Math.round(row.entries.reduce((s, e) => s + e.proteinActual,  0));
                  const gCarbs   = Math.round(row.entries.reduce((s, e) => s + e.carbsActual,    0));
                  const gFat     = Math.round(row.entries.reduce((s, e) => s + e.fatActual,      0));
                  return (
                    <View key={`group-${row.groupId}-${rowIdx}`} style={{ borderTopWidth: 1, borderTopColor: border }}>
                      {/* Group header — name + combined macros */}
                      <View style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: text }}>{row.groupName}</Text>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: muted }}>{gCals} kcal</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Manrope", color: LIME }}>P {gProtein}g</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Manrope", color: BLUE }}>C {gCarbs}g</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Manrope", color: PURPLE }}>F {gFat}g</Text>
                        </View>
                      </View>
                      {/* Individual ingredient lines — tap to adjust serving amount */}
                      {row.entries.map(e => (
                        <Pressable
                          key={e.id}
                          onPress={() => openDetail(e)}
                          style={({ pressed }) => ({ paddingHorizontal: 18, paddingVertical: 6, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: `${border}88`, opacity: pressed ? 0.6 : 1 })}
                        >
                          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: muted, marginRight: 10, opacity: 0.4 }} />
                          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: "Manrope", color: muted }}>{e.foodName}</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>{Math.round(e.caloriesActual)} kcal</Text>
                        </Pressable>
                      ))}
                      {/* Full-width Remove button at the bottom */}
                      <Pressable
                        onPress={() => row.entries.forEach(e => deleteEntry.mutate(e.id))}
                        style={({ pressed }) => ({
                          borderTopWidth: 1, borderTopColor: border,
                          paddingVertical: 11, alignItems: "center",
                          opacity: pressed ? 0.5 : 1,
                        })}
                      >
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#ef4444" }}>Remove from Log</Text>
                      </Pressable>
                    </View>
                  );
                }
                // Plain single entry
                const entry = row.entry;
                return (
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
                );
              })}
            </View>
          );
        })}

        {/* ── Tab: Saved Meals ── */}
        {tab === "meals" && (
          <>
            {/* Create new meal button */}
            <Pressable
              onPress={() => { setEditingMeal(null); setNewMealName(""); setNewMealDesc(""); setNewMealIngredients([]); closeMealPicker(); setShowCreateMeal(true); }}
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
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Pressable
                          onPress={() => openEditMeal(meal)}
                          hitSlop={8}
                          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                        >
                          <PenLine size={15} color={muted} />
                        </Pressable>
                        <Pressable
                          onPress={() => Alert.alert("Delete meal", `Delete "${meal.name}"?`, [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteMeal.mutate(meal.id) },
                          ])}
                          hitSlop={8}
                          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                        >
                          <Trash2 size={15} color={muted} />
                        </Pressable>
                      </View>
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
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#ffffff" }}>
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

          // Live serving amount being edited, and its ratio against what was logged
          const svNum          = parseFloat(editServings) || e.servings;
          const servingsChanged = Math.abs(svNum - e.servings) > 0.001;
          const ratio          = e.servings > 0 ? svNum / e.servings : 1;

          // Actuals (what was actually logged), scaled live to the edited serving amount
          const totalCal = Math.round(e.caloriesActual * ratio);
          const p = Math.round(e.proteinActual * ratio);
          const c = Math.round(e.carbsActual * ratio);
          const f = Math.round(e.fatActual * ratio);

          // Per-serving from item (if available), scaled by the edited serving amount
          const servSizeG    = item?.servingSizeG;
          const servUnit     = item?.servingUnit ?? "g";
          const sv           = svNum;
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

                {/* Serving amount stepper + loading */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Pressable
                      onPress={() => setEditServings(String(Math.max(0.25, Math.round((svNum - 0.25) / 0.25) * 0.25)))}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                        backgroundColor: card, borderWidth: 1, borderColor: border, opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Minus size={14} color={text} />
                    </Pressable>
                    <TextInput
                      value={editServings}
                      onChangeText={setEditServings}
                      onBlur={() => { if (!parseFloat(editServings)) setEditServings(String(e.servings)); }}
                      keyboardType="decimal-pad"
                      style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text, minWidth: 36, textAlign: "center", paddingVertical: 4 }}
                    />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                      {svNum === 1 ? "serving" : "servings"}
                      {/* Only append "<grams><unit>" when servingUnit is actually a short
                          weight/volume unit — many cached items store a full description
                          (e.g. "1 serving", "2/3 cup (55g)") in this field instead. */}
                      {servSizeG && /^(g|kg|oz|lb|ml|l|fl ?oz)$/i.test(servUnit.trim())
                        ? `  ·  ${Math.round(servSizeG * svNum)}${servUnit}`
                        : ""}
                    </Text>
                    <Pressable
                      onPress={() => setEditServings(String(Math.round((svNum + 0.25) / 0.25) * 0.25))}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                        backgroundColor: card, borderWidth: 1, borderColor: border, opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Plus size={14} color={text} />
                    </Pressable>
                  </View>
                  {detailLoading && <ActivityIndicator size="small" color={accent} />}
                </View>

                {/* Save button — only when the serving amount has been changed */}
                {servingsChanged && (
                  <Pressable
                    onPress={saveServings}
                    disabled={updateEntry.isPending}
                    style={({ pressed }) => ({
                      marginBottom: 16, paddingVertical: 12, borderRadius: 14, alignItems: "center",
                      backgroundColor: accentActive, opacity: pressed || updateEntry.isPending ? 0.7 : 1,
                    })}
                  >
                    {updateEntry.isPending ? (
                      <ActivityIndicator size="small" color={isWhite ? "#fff" : palette.accentText} />
                    ) : (
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: isWhite ? "#fff" : palette.accentText }}>
                        Update Serving Amount
                      </Text>
                    )}
                  </Pressable>
                )}

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
                    Alert.alert("Remove item?", `Remove ${name} from ${selectedDate === today ? "today's" : formatDate(selectedDate) + "'s"} log?`, [
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
            {mealPickerPage === "item" ? (
              <Pressable onPress={() => { setMealPickerItem(null); setMealPickerServings("1"); setMealPickerPage("search"); }} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted }}>Back</Text>
              </Pressable>
            ) : mealPickerPage === "barcode" ? (
              <Pressable onPress={() => { setMealPickerBarcodeError(""); setMealPickerBarcodeManualCode(""); setMealPickerPage("search"); }} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted }}>Back</Text>
              </Pressable>
            ) : mealPickerPage === "search" ? (
              <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>Add Ingredients</Text>
            ) : (
              <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>
                {editingMeal ? "Edit Meal" : "New Saved Meal"}
              </Text>
            )}
            {mealPickerPage === "search" ? (
              <Pressable onPress={closeMealPicker} style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: accentActive, borderRadius: 20 }}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: isWhite ? "#fff" : palette.accentText }}>
                  Done{newMealIngredients.length > 0 ? ` (${newMealIngredients.length})` : ""}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={closeMealModal}>
                <X size={22} color={text} />
              </Pressable>
            )}
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
                  <Plus size={14} color={text} />
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>Add Food</Text>
                </Pressable>
              </View>

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

              {/* Always-visible add button — below the list so it's found naturally when scrolling */}
              <Pressable
                onPress={() => setMealPickerPage("search")}
                style={({ pressed }) => ({
                  borderRadius: 14, borderWidth: 1.5, borderColor: border, borderStyle: "dashed",
                  paddingVertical: 20, alignItems: "center", marginBottom: 16, opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>
                  {newMealIngredients.length === 0 ? "Tap to add ingredients" : "+ Add another ingredient"}
                </Text>
              </Pressable>

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
                disabled={createMeal.isPending || updateMeal.isPending || !newMealName.trim() || newMealIngredients.length === 0}
                style={({ pressed }) => ({
                  backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center",
                  opacity: (pressed || createMeal.isPending || updateMeal.isPending || !newMealName.trim() || newMealIngredients.length === 0) ? 0.6 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                  {(createMeal.isPending || updateMeal.isPending)
                    ? "Saving…"
                    : editingMeal ? "Update Meal" : "Save Meal"}
                </Text>
              </Pressable>
            </ScrollView>
          )}

          {/* ── PAGE: Ingredient search ── */}
          {mealPickerPage === "search" && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

              {/* Scan action buttons */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
                <Pressable
                  onPress={mealOpenBarcodeCapture}
                  style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingVertical: 14, opacity: pressed ? 0.7 : 1 })}
                >
                  <ScanLine size={18} color={text} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>Scan Barcode</Text>
                </Pressable>
                <Pressable
                  onPress={mealOpenScanLabel}
                  disabled={mealPickerScanLabelLoading}
                  style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingVertical: 14, opacity: (pressed || mealPickerScanLabelLoading) ? 0.7 : 1 })}
                >
                  {mealPickerScanLabelLoading
                    ? <ActivityIndicator size="small" color={muted} />
                    : <Camera size={18} color={text} />
                  }
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>
                    {mealPickerScanLabelLoading ? "Reading…" : "Scan Label"}
                  </Text>
                </Pressable>
              </View>
              {mealPickerScanLabelError ? (
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#ef4444", marginBottom: 10 }}>{mealPickerScanLabelError}</Text>
              ) : null}

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

              {/* Recently used foods — shown when search box is empty */}
              {mealPickerQuery.length === 0 && recentFoods.length > 0 && (
                <>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>RECENTLY USED</Text>
                  {recentFoods.map(item => (
                    <Pressable
                      key={item.id}
                      onPress={() => { setMealPickerItem(item); setMealPickerPage("item"); }}
                      style={({ pressed }) => ({ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 8, opacity: pressed ? 0.7 : 1 })}
                    >
                      {item.brand && <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#aaaaaa", letterSpacing: 0.6, marginBottom: 2 }}>{item.brand.toUpperCase()}</Text>}
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{item.name}</Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>{item.calories} kcal · P {item.proteinG}g · C {item.carbsG}g · F {item.fatG}g</Text>
                    </Pressable>
                  ))}
                </>
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

          {/* ── PAGE: Barcode scanner ── */}
          {mealPickerPage === "barcode" && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {mealPickerBarcodeLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 48 }}>
                  <ActivityIndicator size="large" color={accentActive} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, marginTop: 14 }}>Looking up product…</Text>
                </View>
              ) : (
                <>
                  <Pressable
                    onPress={mealOpenBarcodeCapture}
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
                  {mealPickerBarcodeError ? (
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#ef4444", textAlign: "center", marginBottom: 16 }}>
                      {mealPickerBarcodeError}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 1 }}>OR ENTER CODE</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput
                      value={mealPickerBarcodeManualCode}
                      onChangeText={setMealPickerBarcodeManualCode}
                      placeholder="e.g. 0123456789012"
                      placeholderTextColor={muted}
                      keyboardType="number-pad"
                      returnKeyType="search"
                      onSubmitEditing={() => mealLookupBarcodeCode(mealPickerBarcodeManualCode)}
                      style={{ flex: 1, backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 15, color: text }}
                    />
                    <Pressable
                      onPress={() => mealLookupBarcodeCode(mealPickerBarcodeManualCode)}
                      disabled={!mealPickerBarcodeManualCode.trim()}
                      style={({ pressed }) => ({
                        backgroundColor: accentActive, borderRadius: 12, paddingHorizontal: 18,
                        justifyContent: "center",
                        opacity: (!mealPickerBarcodeManualCode.trim() || pressed) ? 0.4 : 1,
                      })}
                    >
                      <Search size={20} color={isWhite ? "#fff" : palette.accentText} />
                    </Pressable>
                  </View>
                </>
              )}
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
                disabled={mealPickerAddingItem}
                style={({ pressed }) => ({ backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center", opacity: (pressed || mealPickerAddingItem) ? 0.7 : 1 })}
              >
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                  {mealPickerAddingItem ? "Adding…" : "Add Ingredient"}
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

                {/* AI quick-log: describe or photograph a meal */}
                <Pressable
                  onPress={() => { setAddView("describe"); setParseError(""); setParsedItems(null); }}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12,
                    backgroundColor: `${accentActive}14`, borderRadius: 16, borderWidth: 1, borderColor: `${accentActive}55`,
                    paddingHorizontal: 16, paddingVertical: 16, opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Sparkles size={22} color={accentActive} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>Describe or snap a meal</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 1 }}>
                      “2 eggs, toast & coffee” — AI estimates the macros
                    </Text>
                  </View>
                  <ChevronRight size={18} color={muted} />
                </Pressable>

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

                {/* My Foods — items this user has logged before, quickly selectable again */}
                {searchQuery.length === 0 && recentFoods.length > 0 && (
                  <View style={{ marginBottom: 18 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>MY FOODS</Text>
                    {recentFoods.map(item => (
                      <Pressable
                        key={item.id}
                        onPress={() => setSelectedItem(item)}
                        style={({ pressed }) => ({ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 8, opacity: pressed ? 0.7 : 1 })}
                      >
                        {item.brand && <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#aaaaaa", letterSpacing: 0.6, marginBottom: 2 }}>{item.brand.toUpperCase()}</Text>}
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{item.name}</Text>
                        <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>{item.calories} kcal · P {item.proteinG}g · C {item.carbsG}g · F {item.fatG}g</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

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

                <Pressable onPress={() => setManualShowExtra(v => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 }}>
                  <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: manualShowExtra ? "180deg" : "0deg" }] }} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                    {manualShowExtra ? "Hide additional nutrition" : "Add additional nutrition (optional)"}
                  </Text>
                </Pressable>

                {manualShowExtra && [
                  { label: "FIBER (g)", value: manualFiber, set: setManualFiber, placeholder: "0" },
                  { label: "SUGAR (g)", value: manualSugar, set: setManualSugar, placeholder: "0" },
                  { label: "SODIUM (mg)", value: manualSodium, set: setManualSodium, placeholder: "0" },
                  { label: "SATURATED FAT (g)", value: manualSatFat, set: setManualSatFat, placeholder: "0" },
                  { label: "TRANS FAT (g)", value: manualTransFat, set: setManualTransFat, placeholder: "0" },
                  { label: "CHOLESTEROL (mg)", value: manualCholesterol, set: setManualCholesterol, placeholder: "0" },
                  { label: "POTASSIUM (mg)", value: manualPotassium, set: setManualPotassium, placeholder: "0" },
                ].map(f => (
                  <View key={f.label} style={{ marginBottom: 14 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>{f.label}</Text>
                    <TextInput
                      value={f.value} onChangeText={f.set}
                      placeholder={f.placeholder} placeholderTextColor={muted}
                      keyboardType="decimal-pad"
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
                  disabled={addEntry.isPending || creatingItem || !manualName.trim()}
                  style={({ pressed }) => ({ backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 8, opacity: (pressed || addEntry.isPending || creatingItem || !manualName.trim()) ? 0.6 : 1 })}
                >
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                    {(addEntry.isPending || creatingItem) ? "Adding…" : `Add to ${MEAL_LABELS[activeMeal]}`}
                  </Text>
                </Pressable>
              </>
            )}

            {/* ── DESCRIBE / SNAP MEAL view (AI) ── */}
            {addView === "describe" && !selectedItem && (
              <>
                <Pressable onPress={() => { setAddView("home"); setMealText(""); setParsedItems(null); setParseError(""); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
                  <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: "90deg" }] }} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>Back</Text>
                </Pressable>

                {/* ── Review parsed items ── */}
                {parsedItems ? (
                  <>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 10 }}>
                      REVIEW · {MEAL_LABELS[activeMeal].toUpperCase()}
                    </Text>
                    {parsedItems.map((it, idx) => (
                      <View key={idx} style={{ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{it.name}</Text>
                          <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>
                            {it.quantity} · {Math.round(it.calories)} kcal · P {it.proteinG}g · C {it.carbsG}g · F {it.fatG}g
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => setParsedItems(prev => {
                            const next = (prev ?? []).filter((_, i) => i !== idx);
                            return next.length ? next : null;
                          })}
                          hitSlop={8}
                          style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.5 : 1 })}
                        >
                          <Trash2 size={16} color={muted} />
                        </Pressable>
                      </View>
                    ))}

                    {/* Totals */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4, marginBottom: 16, paddingHorizontal: 4 }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>Total</Text>
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                        {Math.round(parsedItems.reduce((s, it) => s + (it.calories || 0), 0))} kcal ·
                        {" "}P {Math.round(parsedItems.reduce((s, it) => s + (it.proteinG || 0), 0))}g ·
                        {" "}C {Math.round(parsedItems.reduce((s, it) => s + (it.carbsG || 0), 0))}g ·
                        {" "}F {Math.round(parsedItems.reduce((s, it) => s + (it.fatG || 0), 0))}g
                      </Text>
                    </View>

                    {parseError ? (
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#ef4444", textAlign: "center", marginBottom: 12 }}>{parseError}</Text>
                    ) : null}

                    <Pressable
                      onPress={confirmQuickLog}
                      disabled={loggingQuick || parsedItems.length === 0}
                      style={({ pressed }) => ({ backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center", opacity: (pressed || loggingQuick) ? 0.6 : 1 })}
                    >
                      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>
                        {loggingQuick ? "Logging…" : `Log ${parsedItems.length} item${parsedItems.length === 1 ? "" : "s"} to ${MEAL_LABELS[activeMeal]}`}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => { setParsedItems(null); setParseError(""); }} style={({ pressed }) => ({ paddingVertical: 14, alignItems: "center", opacity: pressed ? 0.6 : 1 })}>
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>Start over</Text>
                    </Pressable>
                  </>
                ) : parsing ? (
                  <View style={{ alignItems: "center", paddingVertical: 48 }}>
                    <ActivityIndicator size="large" color={accentActive} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, marginTop: 14 }}>
                      Claude is estimating the macros…
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 8 }}>DESCRIBE YOUR MEAL</Text>
                    <TextInput
                      value={mealText}
                      onChangeText={setMealText}
                      placeholder={"e.g. 2 scrambled eggs, 2 slices wheat toast with butter, and a black coffee"}
                      placeholderTextColor={muted}
                      multiline
                      autoFocus
                      style={{ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, fontFamily: "Manrope", fontSize: 15, color: text, minHeight: 100, textAlignVertical: "top" }}
                    />

                    {parseError ? (
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#ef4444", textAlign: "center", marginTop: 12 }}>{parseError}</Text>
                    ) : null}

                    <Pressable
                      onPress={parseMealDescription}
                      disabled={!mealText.trim()}
                      style={({ pressed }) => ({ backgroundColor: accentActive, borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 14, flexDirection: "row", justifyContent: "center", gap: 8, opacity: (pressed || !mealText.trim()) ? 0.6 : 1 })}
                    >
                      <Sparkles size={18} color={isWhite ? "#fff" : palette.accentText} />
                      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: isWhite ? "#fff" : palette.accentText }}>Estimate macros</Text>
                    </Pressable>

                    {Platform.OS === "web" && (
                      <>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 }}>
                          <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 1 }}>OR</Text>
                          <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                        </View>
                        <Pressable
                          onPress={openSnapMeal}
                          style={({ pressed }) => ({ backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, paddingVertical: 18, alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 })}
                        >
                          <Camera size={26} color={text} />
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>Snap a photo of your plate</Text>
                        </Pressable>
                      </>
                    )}
                  </>
                )}
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
                    disabled={addEntry.isPending || creatingItem}
                    style={({ pressed }) => ({ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: accentActive, alignItems: "center", opacity: (pressed || addEntry.isPending || creatingItem) ? 0.7 : 1 })}
                  >
                    <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 14, color: isWhite ? "#fff" : palette.accentText }}>
                      {(addEntry.isPending || creatingItem) ? "Adding…" : `Add to ${MEAL_LABELS[activeMeal]}`}
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
