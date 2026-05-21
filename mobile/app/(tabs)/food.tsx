import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, TextInput,
  Modal, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { todayStr } from "@/lib/utils";
import { Plus, Search, X, ChevronRight, UtensilsCrossed, Trash2 } from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";

const today = todayStr();
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
  const { palette, isWhite } = useTheme();
  const qc = useQueryClient();

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
  // when adding to a saved meal (not food log)
  const [addingToMealId, setAddingToMealId] = useState<number | null>(null);

  // ── Create meal modal ──
  const [showCreateMeal, setShowCreateMeal]         = useState(false);
  const [newMealName, setNewMealName]               = useState("");
  const [newMealDesc, setNewMealDesc]               = useState("");
  const [newMealIngredients, setNewMealIngredients] = useState<
    { foodItem: FoodItem; servings: number }[]
  >([]);
  const [mealIngredientServings, setMealIngredientServings] = useState("1");

  // ── Food detail modal ──
  const [detailEntry, setDetailEntry] = useState<FoodLogEntry | null>(null);

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/food-log", today] });
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
    setAddingToMealId(null);
    setSearchFilter("all");
  }

  function openAddForMeal(meal: MealType) {
    setActiveMeal(meal);
    setAddingToMealId(null);
    setSelectedItem(null);
    setSearchQuery("");
    setSearchResults([]);
    setServings("1");
    setShowAdd(true);
  }

  function openAddForSavedMeal(mealId: number) {
    setAddingToMealId(mealId);
    setSelectedItem(null);
    setSearchQuery("");
    setSearchResults([]);
    setMealIngredientServings("1");
    setShowAdd(true);
  }

  // ── Search filter: "all" | "restaurant" ──────────────────────────────────
  const [searchFilter, setSearchFilter] = useState<"all" | "restaurant">("all");

  // ── Debounced live search ──────────────────────────────────────────────────
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
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
    });
  }

  function addToSavedMeal() {
    if (!selectedItem) return;
    const sv = parseFloat(mealIngredientServings) || 1;
    setNewMealIngredients(prev => [
      ...prev,
      { foodItem: selectedItem, servings: sv },
    ]);
    setSelectedItem(null);
    setSearchQuery("");
    setSearchResults([]);
    setMealIngredientServings("1");
    setShowAdd(false);
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
            <View key={meal} style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, marginBottom: 10, overflow: "hidden" }}>
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
                  onPress={() => setDetailEntry(entry)}
                  style={({ pressed }) => ({
                    borderTopWidth: 1, borderTopColor: border,
                    paddingHorizontal: 18, paddingVertical: 12,
                    flexDirection: "row", alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: "Manrope-SemiBold", color: text }}>
                      {entry.foodName ?? entry.foodItem?.name ?? `Food #${entry.foodItemId}`}
                    </Text>
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
        onRequestClose={() => setDetailEntry(null)}
      >
        {detailEntry && (() => {
          const e = detailEntry;
          const name = e.foodName ?? e.foodItem?.name ?? `Food #${e.foodItemId}`;
          const totalCal = e.caloriesActual;
          const p = Math.round(e.proteinActual);
          const c = Math.round(e.carbsActual);
          const f = Math.round(e.fatActual);
          const calFromP = p * 4, calFromC = c * 4, calFromF = f * 9;
          const macroTotal = calFromP + calFromC + calFromF || 1;
          return (
            <View style={{ flex: 1, backgroundColor: bg }}>
              {/* Header */}
              <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: border }}>
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text, flex: 1, marginRight: 12 }} numberOfLines={2}>
                  {name}
                </Text>
                <Pressable onPress={() => setDetailEntry(null)} hitSlop={8}><X size={22} color={text} /></Pressable>
              </View>

              <ScrollView contentContainerStyle={{ padding: 20 }}>
                {/* Serving info */}
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginBottom: 20 }}>
                  {e.servings === 1 ? "1 serving" : `${e.servings} servings`}
                </Text>

                {/* Calories hero */}
                <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 20, alignItems: "center", marginBottom: 14 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>CALORIES</Text>
                  <Text style={{ ...(DOT as any), fontSize: 52, color: text, lineHeight: 56 }}>{Math.round(totalCal)}</Text>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginTop: 4 }}>kcal</Text>
                </View>

                {/* Macro breakdown */}
                {([
                  { label: "Protein", val: p, unit: "g", color: LIME,   calPct: calFromP / macroTotal },
                  { label: "Carbs",   val: c, unit: "g", color: BLUE,   calPct: calFromC / macroTotal },
                  { label: "Fat",     val: f, unit: "g", color: PURPLE, calPct: calFromF / macroTotal },
                ] as const).map(m => (
                  <View key={m.label} style={{ backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 16, marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>{m.label}</Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                        <Text style={{ ...(DOT as any), fontSize: 24, color: m.color, lineHeight: 28 }}>{m.val}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: muted }}>{m.unit}</Text>
                      </View>
                    </View>
                    {/* Percentage bar */}
                    <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                      <View style={{ width: `${(m.calPct * 100).toFixed(1)}%` as any, height: "100%", backgroundColor: m.color, borderRadius: 3 }} />
                    </View>
                    <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, marginTop: 6 }}>
                      {Math.round(m.calPct * 100)}% of calories · {m.val * (m.label === "Fat" ? 9 : 4)} kcal
                    </Text>
                  </View>
                ))}

                {/* Delete button */}
                <Pressable
                  onPress={() => {
                    Alert.alert("Remove item?", `Remove ${name} from today's log?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => {
                        deleteEntry.mutate(e.id);
                        setDetailEntry(null);
                      }},
                    ]);
                  }}
                  style={({ pressed }) => ({
                    marginTop: 10, paddingVertical: 14, borderRadius: 16, alignItems: "center",
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

      {/* ── Add Food Modal ── */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: border }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>
              {addingToMealId ? "Add Ingredient" : `Add to ${MEAL_LABELS[activeMeal]}`}
            </Text>
            <Pressable onPress={closeAddModal}><X size={22} color={text} /></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {!selectedItem ? (
              <>
                {/* Search bar */}
                <View style={{
                  flexDirection: "row", alignItems: "center",
                  backgroundColor: card, borderRadius: 14,
                  borderWidth: 1, borderColor: border,
                  paddingHorizontal: 12, paddingVertical: 10, gap: 8,
                  marginBottom: 10,
                }}>
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

                {/* Filter toggle: All / Restaurants */}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                  {(["all", "restaurant"] as const).map(f => (
                    <Pressable
                      key={f}
                      onPress={() => setSearchFilter(f)}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                        backgroundColor: searchFilter === f ? accentActive : card,
                        borderWidth: 1, borderColor: searchFilter === f ? accentActive : border,
                      }}
                    >
                      <Text style={{
                        fontFamily: "Manrope-SemiBold", fontSize: 12,
                        color: searchFilter === f ? (isWhite ? "#fff" : palette.accentText) : muted,
                      }}>
                        {f === "all" ? "All Foods" : "Restaurants"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Popular restaurant quick-picks (shown when no query typed) */}
                {searchQuery.length < 2 && (
                  <View style={{ marginBottom: 18 }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 10 }}>
                      POPULAR RESTAURANTS
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {[
                        "McDonald's", "Chipotle", "Starbucks", "Chick-fil-A",
                        "Subway", "Taco Bell", "Panera", "Wendy's",
                        "Domino's", "Olive Garden", "Shake Shack", "Five Guys",
                      ].map(r => (
                        <Pressable
                          key={r}
                          onPress={() => { setSearchFilter("restaurant"); setSearchQuery(r); }}
                          style={({ pressed }) => ({
                            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                            backgroundColor: card, borderWidth: 1, borderColor: border,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: text }}>{r}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, textAlign: "center", marginTop: 10 }}>
                    No results found
                  </Text>
                )}

                {searchResults.map(item => (
                  <Pressable
                    key={(item.id ?? 0) + "_" + item.name}
                    onPress={() => setSelectedItem(item)}
                    style={({ pressed }) => ({ backgroundColor: card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: border, marginBottom: 8, opacity: pressed ? 0.7 : 1 })}
                  >
                    {item.brand && (
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#aaaaaa", letterSpacing: 0.6, marginBottom: 2 }}>
                        {item.brand.toUpperCase()}
                      </Text>
                    )}
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{item.name}</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>
                      {item.calories} kcal · P {item.proteinG}g · C {item.carbsG}g · F {item.fatG}g
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : (
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
                  value={addingToMealId ? mealIngredientServings : servings}
                  onChangeText={addingToMealId ? setMealIngredientServings : setServings}
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: card, borderRadius: 12, padding: 14, color: text, fontFamily: "Manrope-ExtraBold", fontSize: 24, borderWidth: 1, borderColor: border, textAlign: "center", marginBottom: 20 }}
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable onPress={() => setSelectedItem(null)} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: border, alignItems: "center" }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>Back</Text>
                  </Pressable>
                  <Pressable
                    onPress={addingToMealId ? addToSavedMeal : addToLog}
                    disabled={addEntry.isPending}
                    style={({ pressed }) => ({ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: accentActive, alignItems: "center", opacity: (pressed || addEntry.isPending) ? 0.7 : 1 })}
                  >
                    <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 14, color: isWhite ? "#fff" : palette.accentText }}>
                      {addEntry.isPending ? "Adding…" : addingToMealId ? "Add Ingredient" : `Add to ${MEAL_LABELS[activeMeal]}`}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Create Meal Modal ── */}
      <Modal visible={showCreateMeal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: border }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>New Saved Meal</Text>
            <Pressable onPress={() => setShowCreateMeal(false)}><X size={22} color={text} /></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {/* Name */}
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>MEAL NAME</Text>
            <TextInput
              value={newMealName}
              onChangeText={setNewMealName}
              placeholder="e.g. My usual breakfast"
              placeholderTextColor={muted}
              style={{ backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 14, color: text, marginBottom: 14 }}
            />

            {/* Description (optional) */}
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8, marginBottom: 6 }}>DESCRIPTION (OPTIONAL)</Text>
            <TextInput
              value={newMealDesc}
              onChangeText={setNewMealDesc}
              placeholder="e.g. Chicken & rice meal prep"
              placeholderTextColor={muted}
              style={{ backgroundColor: card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: border, fontFamily: "Manrope-SemiBold", fontSize: 14, color: text, marginBottom: 20 }}
            />

            {/* Ingredients */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, letterSpacing: 0.8 }}>
                INGREDIENTS ({newMealIngredients.length})
              </Text>
              <Pressable
                onPress={() => openAddForSavedMeal(-1)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
              >
                <Plus size={14} color={accentActive} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: accentActive }}>Add Food</Text>
              </Pressable>
            </View>

            {newMealIngredients.length === 0 && (
              <Pressable
                onPress={() => openAddForSavedMeal(-1)}
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
                <Pressable
                  onPress={() => setNewMealIngredients(prev => prev.filter((_, j) => j !== i))}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <X size={15} color={muted} />
                </Pressable>
              </View>
            ))}

            {/* Total summary */}
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
        </View>
      </Modal>
    </SafeAreaView>
  );
}
