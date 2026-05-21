import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { NutritionCapture } from "@/components/NutritionCapture";
import { MacroRing } from "@/components/MacroRing";
import { Plus, Trash2, ScanLine, Camera, Search, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { todayStr } from "@/lib/utils";
import type { FoodLogEntry, NutritionTarget, FoodItem } from "@shared/schema";

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealType = typeof MEALS[number];

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

interface FoodData {
  name: string;
  brand?: string;
  barcode?: string;
  servingSizeG: number;
  servingUnit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
}

function dateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function FoodLog() {
  const qc = useQueryClient();
  const [dayOffset, setDayOffset] = useState(0);
  const date = dateStr(dayOffset);

  const [showAdd, setShowAdd] = useState(false);
  const [addMeal, setAddMeal] = useState<MealType>("breakfast");
  const [showBarcode, setShowBarcode] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoodData[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingFood, setPendingFood] = useState<FoodData | null>(null);
  const [servings, setServings] = useState("1");

  const { data: targets } = useQuery<NutritionTarget | null>({ queryKey: ["/api/targets"] });
  const { data: log = [] } = useQuery<FoodLogEntry[]>({
    queryKey: ["/api/food-log", date],
    queryFn: () => apiRequest("GET", `/api/food-log?date=${date}`),
  });

  const totals = log.reduce((acc, e) => ({
    calories: acc.calories + e.caloriesActual,
    protein: acc.protein + e.proteinActual,
    carbs: acc.carbs + e.carbsActual,
    fat: acc.fat + e.fatActual,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const addEntry = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/food-log", { ...data, date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/food-log", date] });
      setPendingFood(null);
      setServings("1");
    },
  });

  const deleteEntry = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/food-log/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/food-log", date] }),
  });

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await apiRequest<FoodData[]>("GET", `/api/food/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }

  async function handleBarcodeScan(barcode: string) {
    try {
      const item = await apiRequest<FoodData>("GET", `/api/food/barcode/${barcode}`);
      setPendingFood(item);
    } catch {
      alert("Product not found in database. Try manual entry.");
    }
  }

  function handleNutritionResult(data: FoodData) {
    setPendingFood(data);
  }

  function confirmAdd() {
    if (!pendingFood) return;
    const s = parseFloat(servings) || 1;
    addEntry.mutate({
      mealType: addMeal,
      foodName: pendingFood.name,
      servings: s,
      caloriesActual: Math.round(pendingFood.calories * s),
      proteinActual: Math.round(pendingFood.proteinG * s * 10) / 10,
      carbsActual: Math.round(pendingFood.carbsG * s * 10) / 10,
      fatActual: Math.round(pendingFood.fatG * s * 10) / 10,
      fiberActual: pendingFood.fiberG ? Math.round(pendingFood.fiberG * s * 10) / 10 : undefined,
    });
  }

  const mealEntries = (meal: MealType) => log.filter(e => e.mealType === meal);
  const mealCals = (meal: MealType) => mealEntries(meal).reduce((a, e) => a + e.caloriesActual, 0);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header with date nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setDayOffset(d => d - 1)} className="p-1 hover:bg-accent rounded">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Food Log</h1>
            <p className="text-sm text-muted-foreground">
              {dayOffset === 0 ? "Today" : dayOffset === -1 ? "Yesterday" : new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </p>
          </div>
          {dayOffset < 0 && (
            <button onClick={() => setDayOffset(d => d + 1)} className="p-1 hover:bg-accent rounded">
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Food
        </Button>
      </div>

      {/* Daily summary — pink calorie card */}
      <div style={{ background: "var(--pink)", borderRadius: 24, padding: 20, color: "#0a0a0a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Big ring */}
          {(() => {
            const calTarget = targets?.calories ?? 2200;
            const ringVal = Math.min(totals.calories / calTarget, 1);
            const r = 50, stroke = 10, c = 2 * Math.PI * r;
            const remaining = Math.max(0, Math.round(calTarget - totals.calories));
            return (
              <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width={120} height={120} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
                  <circle cx={60} cy={60} r={r} stroke="rgba(0,0,0,0.12)" strokeWidth={stroke} fill="none" />
                  <circle cx={60} cy={60} r={r} stroke="#0a0a0a" strokeWidth={stroke} fill="none"
                    strokeDasharray={c} strokeDashoffset={c * (1 - ringVal)} strokeLinecap="round"
                    style={{ transition: "stroke-dashoffset .6s ease" }} />
                </svg>
                <div style={{ textAlign: "center", zIndex: 1 }}>
                  <div className="dot" style={{ fontSize: 26, color: "#0a0a0a", lineHeight: 1 }}>{remaining}</div>
                  <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.55, marginTop: 2 }}>LEFT</div>
                </div>
              </div>
            );
          })()}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.6, letterSpacing: "0.05em" }}>EATEN · TODAY</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
              <span className="dot" style={{ fontSize: 34, lineHeight: 1 }}>{Math.round(totals.calories).toLocaleString()}</span>
              <span style={{ fontSize: 12, fontWeight: 800, opacity: 0.5 }}>/ {Math.round(targets?.calories ?? 0)}</span>
            </div>
          </div>
        </div>
        {/* Macro progress bars */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
          {([
            { label: "PROTEIN", val: Math.round(totals.protein), target: Math.round(targets?.proteinG ?? 0), color: "#0a0a0a" },
            { label: "CARBS",   val: Math.round(totals.carbs),   target: Math.round(targets?.carbsG ?? 0),   color: "#0a0a0a" },
            { label: "FAT",     val: Math.round(totals.fat),     target: Math.round(targets?.fatG ?? 0),     color: "#0a0a0a" },
          ] as const).map(m => (
            <div key={m.label}>
              <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.55, letterSpacing: "0.08em" }}>{m.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>{m.val}<span style={{ fontSize: 10, opacity: 0.55 }}>/{m.target}g</span></div>
              <div style={{ height: 4, background: "rgba(0,0,0,0.15)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(m.target > 0 ? (m.val / m.target) * 100 : 0, 100)}%`, height: "100%", background: "#0a0a0a", borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Meals */}
      <div className="space-y-4">
        {MEALS.map(meal => (
          <Card key={meal}>
            <CardHeader className="py-3 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base capitalize flex items-center gap-2">
                  {MEAL_LABELS[meal]}
                  <span className="text-sm text-muted-foreground font-normal">{Math.round(mealCals(meal))} kcal</span>
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => { setAddMeal(meal); setShowAdd(true); }}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            {mealEntries(meal).length > 0 && (
              <CardContent className="pt-0 pb-3 space-y-1">
                {mealEntries(meal).map(entry => (
                  <div key={entry.id} className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-accent/50 group">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{entry.foodName}</div>
                      <div className="text-xs text-muted-foreground">
                        {entry.servings !== 1 && `${entry.servings}x · `}
                        P {Math.round(entry.proteinActual)}g · C {Math.round(entry.carbsActual)}g · F {Math.round(entry.fatActual)}g
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className="text-sm font-semibold">{Math.round(entry.caloriesActual)}</span>
                      <button onClick={() => deleteEntry.mutate(entry.id)} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Add Food Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Food</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Meal</Label>
              <Select value={addMeal} onValueChange={(v) => setAddMeal(v as MealType)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEALS.map(m => <SelectItem key={m} value={m}>{MEAL_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Scan / Capture buttons */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setShowBarcode(true); }}>
                <ScanLine className="w-4 h-4 mr-2" /> Barcode
              </Button>
              <Button variant="outline" onClick={() => { setShowAdd(false); setShowCapture(true); }}>
                <Camera className="w-4 h-4 mr-2" /> Scan Label
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or search</span></div>
            </div>

            {/* Search */}
            <div className="flex gap-2">
              <Input placeholder="Search food..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} />
              <Button variant="outline" onClick={handleSearch} disabled={searching}>
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && !pendingFood && (
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-1">
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => { setPendingFood(r); setSearchResults([]); }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-accent text-sm">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.brand && `${r.brand} · `}{Math.round(r.calories)} kcal · {r.servingUnit}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Manual entry */}
            {!pendingFood && !searchResults.length && (
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground"
                onClick={() => setPendingFood({ name: "", servingSizeG: 100, servingUnit: "serving", calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })}>
                <Pencil className="w-3 h-3 mr-2" /> Manual entry
              </Button>
            )}

            {/* Confirm / adjust food */}
            {pendingFood && (
              <div className="space-y-3 border rounded-lg p-3 bg-accent/30">
                {pendingFood.name === "" ? (
                  <ManualFoodForm food={pendingFood} onChange={setPendingFood} />
                ) : (
                  <>
                    <div>
                      <div className="font-medium">{pendingFood.name}</div>
                      {pendingFood.brand && <div className="text-xs text-muted-foreground">{pendingFood.brand}</div>}
                      <div className="text-xs text-muted-foreground mt-1">
                        Per {pendingFood.servingUnit}: {Math.round(pendingFood.calories)} kcal · P {pendingFood.proteinG}g · C {pendingFood.carbsG}g · F {pendingFood.fatG}g
                      </div>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <Label className="text-sm w-16 flex-shrink-0">Servings</Label>
                  <Input type="number" min="0.1" step="0.5" value={servings} onChange={e => setServings(e.target.value)} className="h-8" />
                </div>
                <div className="text-xs text-muted-foreground">
                  Total: {Math.round(pendingFood.calories * (parseFloat(servings) || 1))} kcal · P {Math.round(pendingFood.proteinG * (parseFloat(servings) || 1))}g · C {Math.round(pendingFood.carbsG * (parseFloat(servings) || 1))}g · F {Math.round(pendingFood.fatG * (parseFloat(servings) || 1))}g
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={confirmAdd} disabled={addEntry.isPending}>Add to {MEAL_LABELS[addMeal]}</Button>
                  <Button variant="outline" onClick={() => setPendingFood(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BarcodeScanner
        open={showBarcode}
        onClose={() => { setShowBarcode(false); setShowAdd(true); }}
        onScan={handleBarcodeScan}
      />
      <NutritionCapture
        open={showCapture}
        onClose={() => { setShowCapture(false); setShowAdd(true); }}
        onResult={handleNutritionResult}
      />
    </div>
  );
}

function ManualFoodForm({ food, onChange }: { food: FoodData; onChange: (f: FoodData) => void }) {
  return (
    <div className="space-y-2">
      <Input placeholder="Food name" value={food.name} onChange={e => onChange({ ...food, name: e.target.value })} />
      <Input placeholder="Serving (e.g. 1 cup)" value={food.servingUnit} onChange={e => onChange({ ...food, servingUnit: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">Calories</Label><Input type="number" value={food.calories} onChange={e => onChange({ ...food, calories: +e.target.value })} className="h-8" /></div>
        <div><Label className="text-xs">Protein (g)</Label><Input type="number" value={food.proteinG} onChange={e => onChange({ ...food, proteinG: +e.target.value })} className="h-8" /></div>
        <div><Label className="text-xs">Carbs (g)</Label><Input type="number" value={food.carbsG} onChange={e => onChange({ ...food, carbsG: +e.target.value })} className="h-8" /></div>
        <div><Label className="text-xs">Fat (g)</Label><Input type="number" value={food.fatG} onChange={e => onChange({ ...food, fatG: +e.target.value })} className="h-8" /></div>
      </div>
    </div>
  );
}
