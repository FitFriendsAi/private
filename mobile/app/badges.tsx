/**
 * Trophy Case — full badge catalog grouped by category, earned badges lit up
 * in their tier color, locked ones grayed out with a lock icon.
 * Route: /badges
 */
import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Lock } from "lucide-react-native";
import { apiRequest } from "@/lib/api";
import { type BadgeDef, type BadgeCategory, TIER_COLOR } from "@shared/badges";

const LIME  = "#C8E84C";
const DARK  = "#111111";
const CARD  = "#1A1A1A";
const MUTED = "#888888";

type BadgeWithStatus = BadgeDef & { earned: boolean; earnedAt: string | null };

const CATEGORY_LABELS: Record<BadgeCategory, string> = {
  strength: "Strength", streak: "Streaks", volume: "Volume", consistency: "Consistency",
};
const CATEGORY_ORDER: BadgeCategory[] = ["strength", "streak", "volume", "consistency"];

function BadgeCard({ badge }: { badge: BadgeWithStatus }) {
  const tierColor = TIER_COLOR[badge.tier];
  return (
    <View style={{
      width: "31%", alignItems: "center", padding: 10, borderRadius: 16,
      backgroundColor: badge.earned ? tierColor + "1a" : CARD,
      borderWidth: 1, borderColor: badge.earned ? tierColor + "55" : "#2a2a2a",
    }}>
      <View style={{
        width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center",
        backgroundColor: badge.earned ? tierColor + "22" : "rgba(255,255,255,0.04)",
        marginBottom: 8,
      }}>
        {badge.earned ? (
          <Text style={{ fontSize: 24 }}>{badge.emoji}</Text>
        ) : (
          <Lock size={18} color="#555" />
        )}
      </View>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: "Manrope-Bold", fontSize: 11, textAlign: "center", lineHeight: 14,
          color: badge.earned ? "#fff" : MUTED,
        }}
      >
        {badge.label}
      </Text>
      {badge.earned && badge.earnedAt && (
        <Text style={{ fontFamily: "Manrope", fontSize: 9, color: MUTED, marginTop: 3 }}>
          {new Date(badge.earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </Text>
      )}
    </View>
  );
}

export default function BadgesScreen() {
  const router = useRouter();

  const { data: badges, isLoading } = useQuery<BadgeWithStatus[]>({
    queryKey: ["/api/badges"],
    queryFn: () => apiRequest("GET", "/api/badges"),
  });

  const grouped = useMemo(() => {
    const map = new Map<BadgeCategory, BadgeWithStatus[]>();
    for (const b of badges ?? []) {
      if (!map.has(b.category)) map.set(b.category, []);
      map.get(b.category)!.push(b);
    }
    return map;
  }, [badges]);

  const earnedCount = badges?.filter(b => b.earned).length ?? 0;
  const totalCount = badges?.length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK }} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: "#222",
      }}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 12 })}
        >
          <ChevronLeft size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: "#fff" }}>
            Trophy Case
          </Text>
          <Text style={{ fontFamily: "Manrope", fontSize: 12, color: LIME, marginTop: 1 }}>
            {earnedCount} / {totalCount} earned
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={LIME} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {CATEGORY_ORDER.map(category => {
            const items = grouped.get(category);
            if (!items || items.length === 0) return null;
            const earnedInCat = items.filter(b => b.earned).length;
            return (
              <View key={category} style={{ marginBottom: 24 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff" }}>
                    {CATEGORY_LABELS[category].toUpperCase()}
                  </Text>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: MUTED }}>
                    {earnedInCat}/{items.length}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }}>
                  {items.map(b => <BadgeCard key={b.id} badge={b} />)}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
