import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { User, Scale, Activity, Check, Palette } from "lucide-react";
import { gramsToLbs, lbsToGrams, todayStr } from "@/lib/utils";
import type { UserProfile, BodyMeasurement } from "@shared/schema";
import { useTheme, PALETTES } from "@/hooks/use-theme";

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { paletteId, setAccent } = useTheme();

  const { data: profile } = useQuery<UserProfile | null>({ queryKey: ["/api/profile"] });
  const { data: measurements = [] } = useQuery<BodyMeasurement[]>({ queryKey: ["/api/measurements"] });

  const [profileForm, setProfileForm] = useState({
    heightFt: "", heightIn: "", birthDate: "", sex: "male",
    activityLevel: "moderate", weightUnitPref: "lbs", volumeUnitPref: "oz",
  });

  const [weightEntry, setWeightEntry] = useState("");
  const [weightSaved, setWeightSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      const totalCm = profile.heightCm ?? 0;
      const totalIn = Math.round(totalCm / 2.54);
      setProfileForm({
        heightFt: String(Math.floor(totalIn / 12)),
        heightIn: String(totalIn % 12),
        birthDate: profile.birthDate ?? "",
        sex: profile.sex ?? "male",
        activityLevel: profile.activityLevel ?? "moderate",
        weightUnitPref: profile.weightUnitPref ?? "lbs",
        volumeUnitPref: profile.volumeUnitPref ?? "oz",
      });
    }
  }, [profile]);

  const saveProfile = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/profile", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/profile"] }); qc.invalidateQueries({ queryKey: ["/api/targets"] }); },
  });

  const logWeight = useMutation({
    mutationFn: (weightGrams: number) => apiRequest("POST", "/api/measurements", { date: todayStr(), weightGrams }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/measurements"] });
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
      setWeightEntry("");
      setWeightSaved(true);
      setTimeout(() => setWeightSaved(false), 2000);
    },
  });

  function handleProfileSave() {
    const ft = parseInt(profileForm.heightFt) || 0;
    const inches = parseInt(profileForm.heightIn) || 0;
    const heightCm = (ft * 12 + inches) * 2.54;
    saveProfile.mutate({
      heightCm: heightCm || null,
      birthDate: profileForm.birthDate || null,
      sex: profileForm.sex,
      activityLevel: profileForm.activityLevel,
      weightUnitPref: profileForm.weightUnitPref,
      volumeUnitPref: profileForm.volumeUnitPref,
    });
  }

  const latestWeight = measurements[0];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile and preferences</p>
      </div>

      {/* Account info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{user?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{user?.email}</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Accent colour */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="w-4 h-4" style={{ color: "var(--pink)" }} /> Accent Colour
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Personalise the app accent colour. Changes apply instantly.
          </p>
          <div className="flex flex-wrap gap-3">
            {PALETTES.map(p => {
              const active = paletteId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setAccent(p.id)}
                  title={p.name}
                  style={{
                    width: 44, height: 44, borderRadius: "50%",
                    background: p.accent,
                    border: active ? `3px solid hsl(var(--foreground))` : "3px solid transparent",
                    outline: active ? "2px solid hsl(var(--background))" : "2px solid transparent",
                    outlineOffset: 1,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "transform 0.15s, border 0.15s",
                    transform: active ? "scale(1.15)" : "scale(1)",
                    boxShadow: active ? `0 0 0 2px ${p.accent}60` : "none",
                  }}
                >
                  {active && (
                    <Check
                      style={{
                        width: 18, height: 18,
                        color: p.accent === "#c8e84c" || p.accent === "#ffffff" || p.accent === "#ffb88c"
                          ? "#0a0a0a" : "#0a0a0a",
                        strokeWidth: 3,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Current: <span className="font-semibold" style={{ color: "var(--pink)" }}>
              {PALETTES.find(p => p.id === paletteId)?.name}
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Weight logging */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="w-4 h-4 text-chart-1" /> Log Today's Weight
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {latestWeight && (
            <p className="text-sm text-muted-foreground">
              Last recorded: <span className="font-medium text-foreground">{gramsToLbs(latestWeight.weightGrams)} lbs</span> on {new Date(latestWeight.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
          )}
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Weight in lbs"
              value={weightEntry}
              onChange={e => setWeightEntry(e.target.value)}
              className="max-w-40"
              onKeyDown={e => e.key === "Enter" && weightEntry && logWeight.mutate(lbsToGrams(parseFloat(weightEntry)))}
            />
            <Button
              onClick={() => weightEntry && logWeight.mutate(lbsToGrams(parseFloat(weightEntry)))}
              disabled={!weightEntry || logWeight.isPending}
              variant={weightSaved ? "secondary" : "default"}
            >
              {weightSaved ? <><Check className="w-4 h-4 mr-1" /> Saved!</> : "Log Weight"}
            </Button>
          </div>
          {measurements.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {measurements.slice(0, 7).map(m => (
                <div key={m.id} className="flex justify-between text-xs text-muted-foreground">
                  <span>{new Date(m.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                  <span className="font-medium text-foreground">{gramsToLbs(m.weightGrams)} lbs</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Body profile */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-chart-2" /> Body Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Height</Label>
              <div className="flex gap-2">
                <Input type="number" placeholder="ft" value={profileForm.heightFt} onChange={e => setProfileForm(f => ({ ...f, heightFt: e.target.value }))} className="w-20" />
                <Input type="number" placeholder="in" value={profileForm.heightIn} onChange={e => setProfileForm(f => ({ ...f, heightIn: e.target.value }))} className="w-20" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" value={profileForm.birthDate} onChange={e => setProfileForm(f => ({ ...f, birthDate: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Biological Sex</Label>
              <Select value={profileForm.sex} onValueChange={v => setProfileForm(f => ({ ...f, sex: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Activity Level</Label>
              <Select value={profileForm.activityLevel} onValueChange={v => setProfileForm(f => ({ ...f, activityLevel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sedentary">Sedentary (desk job)</SelectItem>
                  <SelectItem value="light">Light (1-2x/week)</SelectItem>
                  <SelectItem value="moderate">Moderate (3-4x/week)</SelectItem>
                  <SelectItem value="active">Active (5-6x/week)</SelectItem>
                  <SelectItem value="very_active">Very Active (2x/day)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Weight Units</Label>
              <Select value={profileForm.weightUnitPref} onValueChange={v => setProfileForm(f => ({ ...f, weightUnitPref: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lbs">Pounds (lbs)</SelectItem>
                  <SelectItem value="kg">Kilograms (kg)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Volume Units</Label>
              <Select value={profileForm.volumeUnitPref} onValueChange={v => setProfileForm(f => ({ ...f, volumeUnitPref: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="oz">Fluid ounces (oz)</SelectItem>
                  <SelectItem value="ml">Milliliters (ml)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleProfileSave} disabled={saveProfile.isPending} className="w-full">
            {saveProfile.isPending ? "Saving..." : saveProfile.isSuccess ? <><Check className="w-4 h-4 mr-1" /> Saved!</> : "Save Profile"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">Saving will recalculate your daily calorie and macro targets.</p>
        </CardContent>
      </Card>
    </div>
  );
}
