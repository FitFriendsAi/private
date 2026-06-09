import { useState } from "react";
import {
  View, Text, ScrollView, Pressable, Alert, TextInput, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import {
  Plus, Heart, MessageCircle, Flame, Dumbbell,
  Target, Zap, Check, UserPlus, Trophy, X, Mail, Smartphone, Send,
} from "lucide-react-native";

const LIME  = "#c8e84c";
const DOT: object = { fontFamily: "Doto" };

// ── Mock feed posts (kept until real social posts are built) ────────
const FEED_POSTS = [
  {
    id: 1, timeAgo: "2h ago",
    title: "Push Day PR! 🔥",
    body: "Finally hit 225 on bench. Months of work paying off!",
    stat: { label: "BENCH PRESS", value: "225", unit: "lbs", bg: "#ffffff", labelColor: "#555", valueColor: "#0a0a0a" },
    likes: 12, comments: 3, reactions: ["🔥", "💪", "🤩"],
  },
  {
    id: 2, timeAgo: "5h ago",
    title: "Meal prepped for the week",
    body: "Hit 185g protein every single day this week. Clean eating is a superpower.",
    stat: { label: "WEEKLY PROTEIN", value: "185", unit: "g avg", bg: LIME, labelColor: "rgba(0,0,0,0.55)", valueColor: "#0a0a0a" },
    likes: 8, comments: 1, reactions: ["💚", "🥗"],
  },
  {
    id: 3, timeAgo: "1d ago",
    title: "Rest day but still hitting steps 🚶",
    body: "12,000 steps, mobility work, and actually got 8 hours of sleep. Recovery is training.",
    stat: null,
    likes: 5, comments: 0, reactions: ["😴", "👣"],
  },
];

const HOW_POINTS = [
  { icon: Dumbbell, label: "Log a workout",        pts: "+100" },
  { icon: Target,   label: "Hit protein target",    pts: "+50"  },
  { icon: Flame,    label: "Daily streak bonus",    pts: "+25"  },
  { icon: Zap,      label: "Set a personal record", pts: "+200" },
];

// ── Avatar circle ───────────────────────────────────────────────────
function Avatar({
  initials, color, size = 44, borderColor, borderWidth = 0,
}: {
  initials: string; color: string; size?: number;
  borderColor?: string; borderWidth?: number;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
      borderWidth, borderColor,
      alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: size * 0.36, color: "#0a0a0a" }}>
        {initials}
      </Text>
    </View>
  );
}

// ── Main ─────────────────────────────────────────────────────────────
const TABS = ["Feed", "Leaderboard", "Challenges"] as const;
type Tab = typeof TABS[number];

export default function FriendsScreen() {
  const { palette } = useTheme();
  const { user }    = useAuth();
  const router      = useRouter();
  const qc          = useQueryClient();
  const { card, cardBorder: border, text, muted, bg } = palette;
  const [tab, setTab]               = useState<Tab>("Feed");
  const [showAddModal, setShowAddModal]   = useState(false);
  const [modalTab, setModalTab]           = useState<"add" | "invite">("add");
  const [addEmail, setAddEmail]           = useState("");
  const [addError, setAddError]           = useState("");
  // Invite state
  const [inviteMethod, setInviteMethod]   = useState<"email" | "sms">("email");
  const [inviteContact, setInviteContact] = useState("");
  const [inviteNote, setInviteNote]       = useState("");
  const [inviteError, setInviteError]     = useState("");
  const [inviteSent, setInviteSent]       = useState(false);

  function openModal(defaultTab: "add" | "invite" = "add") {
    setModalTab(defaultTab);
    setAddEmail(""); setAddError("");
    setInviteContact(""); setInviteNote(""); setInviteError(""); setInviteSent(false);
    setShowAddModal(true);
  }
  function closeModal() {
    setShowAddModal(false);
  }

  const myInitial = (user?.name?.[0] ?? "Y").toUpperCase();

  // ── Data ──
  const { data: friends = [], isLoading: loadingFriends } = useQuery<any[]>({
    queryKey: ["/api/friends"],
    queryFn:  () => apiRequest("GET", "/api/friends"),
  });

  const { data: pendingRequests = [] } = useQuery<any[]>({
    queryKey: ["/api/friends/requests"],
    queryFn:  () => apiRequest("GET", "/api/friends/requests"),
  });

  const sendRequestMutation = useMutation({
    mutationFn: (email: string) => apiRequest("POST", "/api/friends/request", { email }),
    onSuccess: () => {
      closeModal();
      Alert.alert("Friend request sent!");
    },
    onError: (err: any) => {
      setAddError(err?.message ?? "Could not send request");
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: (body: { method: "email" | "sms"; contact: string; personalNote?: string }) =>
      apiRequest("POST", "/api/invite", body),
    onSuccess: () => {
      setInviteSent(true);
      setInviteError("");
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Could not send invitation";
      // If already registered, offer to switch to Add Friend flow
      if (err?.alreadyRegistered) {
        setInviteError(msg);
      } else {
        setInviteError(msg);
      }
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/friends/${id}/accept`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/friends"] }); qc.invalidateQueries({ queryKey: ["/api/friends/requests"] }); },
  });

  const removeMutation = useMutation({
    mutationFn: (friendId: number) => apiRequest("DELETE", `/api/friends/${friendId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/friends"] }); },
  });

  // My own computed points (sum of friends for leaderboard reference)
  const MY_PTS    = 3750;
  const MY_STREAK = 9;

  // Leaderboard: real friends + me
  const leaderboard = [
    ...friends,
    { id: user?.id ?? 0, name: user?.name ?? "You", initials: myInitial, color: "#ffffff", streak: MY_STREAK, points: MY_PTS, isMe: true },
  ].sort((a: any, b: any) => (b.points ?? 0) - (a.points ?? 0));

  const myRank     = leaderboard.findIndex((e: any) => e.isMe) + 1;
  const above      = leaderboard[myRank - 2];
  const ptsToNext  = above ? (above.points ?? 0) - MY_PTS : 0;
  const ptsProgress = above ? MY_PTS / (above.points ?? 1) : 1;
  const MEDAL = ["🥇", "🥈", "🥉"];

  function goToProfile(friendId: number) {
    router.push(`/friend/${friendId}` as any);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>

      {/* ── Header ── */}
      <View style={{
        flexDirection: "row", alignItems: "flex-start",
        justifyContent: "space-between",
        paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
      }}>
        <View>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 28, color: text }}>Friends</Text>
          <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginTop: 1 }}>
            Stay motivated together
          </Text>
        </View>
        <Pressable
          onPress={() => openModal("add")}
          style={({ pressed }) => ({
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: "#1e1e1e", borderWidth: 1, borderColor: border,
            alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1,
          })}
        >
          <UserPlus size={18} color={text} />
        </Pressable>
      </View>

      {/* ── Pending requests banner ── */}
      {pendingRequests.length > 0 && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: "#1a1a1a", borderRadius: 14, borderWidth: 1, borderColor: LIME, padding: 12, gap: 8 }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: LIME, letterSpacing: 0.8 }}>
            FRIEND REQUESTS ({pendingRequests.length})
          </Text>
          {pendingRequests.map((req: any) => (
            <View key={req.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Avatar initials={req.initials} color={req.color} size={36} />
              <Text style={{ flex: 1, fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{req.senderName}</Text>
              <Pressable onPress={() => acceptMutation.mutate(req.id)}
                style={({ pressed }) => ({ backgroundColor: LIME, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#0a0a0a" }}>Accept</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* ── 3-tab toggle ── */}
      <View style={{
        flexDirection: "row", backgroundColor: "#1a1a1a",
        borderRadius: 16, padding: 4,
        marginHorizontal: 16, marginBottom: 16,
      }}>
        {TABS.map(t => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={({ pressed }) => ({
              flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: "center",
              backgroundColor: tab === t ? "#ffffff" : "transparent",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{
              fontFamily: "Manrope-Bold", fontSize: 13,
              color: tab === t ? "#0a0a0a" : "#777777",
            }}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Content ── */}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ════════════ FEED ════════════ */}
        {tab === "Feed" && (
          <View>
            {/* Stories row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 14 }}
            >
              <View style={{ alignItems: "center", gap: 6 }}>
                <View style={{
                  width: 60, height: 60, borderRadius: 30,
                  borderWidth: 1.5, borderStyle: "dashed", borderColor: "#444444",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Plus size={22} color="#666666" />
                </View>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted }}>Share</Text>
              </View>

              {loadingFriends ? (
                <ActivityIndicator color={LIME} style={{ alignSelf: "center" }} />
              ) : friends.length === 0 ? (
                <View style={{ justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>Add friends to see their activity</Text>
                </View>
              ) : (
                friends.map((f: any) => (
                  <Pressable key={f.id} onPress={() => goToProfile(f.id)} style={{ alignItems: "center", gap: 6 }}>
                    <View style={{
                      width: 64, height: 64, borderRadius: 32,
                      borderWidth: 2.5, borderColor: f.color,
                      padding: 2, alignItems: "center", justifyContent: "center",
                    }}>
                      <Avatar initials={f.initials} color={f.color} size={54} />
                    </View>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: text }}>
                      {f.name.split(" ")[0]}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>

            {/* Posts */}
            <View style={{ paddingHorizontal: 16, gap: 12 }}>
              {friends.length === 0 && !loadingFriends ? (
                <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 32, alignItems: "center", gap: 14 }}>
                  <UserPlus size={32} color={muted} strokeWidth={1.5} />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, textAlign: "center" }}>
                    No friends yet
                  </Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable
                      onPress={() => openModal("add")}
                      style={({ pressed }) => ({
                        flex: 1, backgroundColor: "#1e1e1e", borderRadius: 14,
                        borderWidth: 1, borderColor: border,
                        paddingVertical: 11, alignItems: "center",
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>Add Friend</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => openModal("invite")}
                      style={({ pressed }) => ({
                        flex: 1, backgroundColor: LIME, borderRadius: 14,
                        paddingVertical: 11, alignItems: "center",
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#0a0a0a" }}>Invite Friends</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                FEED_POSTS.map((post, idx) => {
                  const friend = friends[idx % Math.max(friends.length, 1)];
                  if (!friend) return null;
                  return (
                    <Pressable key={post.id} onPress={() => goToProfile(friend.id)} style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <Avatar initials={friend.initials} color={friend.color} size={40} />
                        <View>
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>{friend.name}</Text>
                          <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted }}>{post.timeAgo}</Text>
                        </View>
                      </View>

                      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: text, marginBottom: 4 }}>
                        {post.title}
                      </Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, lineHeight: 19, marginBottom: 12 }}>
                        {post.body}
                      </Text>

                      {post.stat && (
                        <View style={{
                          backgroundColor: post.stat.bg, borderRadius: 14,
                          paddingHorizontal: 16, paddingVertical: 14,
                          flexDirection: "row", alignItems: "center",
                          justifyContent: "space-between", marginBottom: 14,
                        }}>
                          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 10, color: post.stat.labelColor, letterSpacing: 0.8 }}>
                            {post.stat.label}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                            <Text style={{ ...(DOT as any), fontSize: 28, color: post.stat.valueColor }}>
                              {post.stat.value}
                            </Text>
                            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: post.stat.labelColor }}>
                              {post.stat.unit}
                            </Text>
                          </View>
                        </View>
                      )}

                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", gap: 16 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                            <Heart size={16} color={muted} />
                            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>{post.likes}</Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                            <MessageCircle size={16} color={muted} />
                            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>{post.comments}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          {post.reactions.map((r, i) => (
                            <Text key={i} style={{ fontSize: 18 }}>{r}</Text>
                          ))}
                        </View>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        )}

        {/* ════════════ LEADERBOARD ════════════ */}
        {tab === "Leaderboard" && (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>

            {/* Your rank card */}
            <View style={{ backgroundColor: "#ffffff", borderRadius: 20, padding: 18 }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#666666", letterSpacing: 0.8 }}>
                YOUR RANK
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                  <Text style={{ ...(DOT as any), fontSize: 48, color: "#0a0a0a", lineHeight: 54 }}>
                    #{myRank}
                  </Text>
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 14, color: "#444444" }}>
                    THIS WEEK
                  </Text>
                </View>
                {ptsToNext > 0 && (
                  <View style={{ backgroundColor: "#eeeeee", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#444444" }}>
                      {ptsToNext.toLocaleString()} pts to #{myRank - 1}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <Text style={{ ...(DOT as any), fontSize: 24, color: "#0a0a0a" }}>{MY_PTS.toLocaleString()}</Text>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#666666" }}>pts</Text>
              </View>
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                  <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "#888888" }}>Progress to next rank</Text>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#333333" }}>
                    {Math.round(ptsProgress * 100)}%
                  </Text>
                </View>
                <View style={{ height: 6, backgroundColor: "#e0e0e0", borderRadius: 3 }}>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: "#0a0a0a", width: `${Math.min(ptsProgress * 100, 100)}%` as any }} />
                </View>
              </View>
            </View>

            {loadingFriends ? (
              <ActivityIndicator color={LIME} style={{ paddingVertical: 40 }} />
            ) : (
              <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, overflow: "hidden" }}>
                {leaderboard.map((entry: any, i) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => !entry.isMe && goToProfile(entry.id)}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", padding: 14, gap: 12,
                      backgroundColor: entry.isMe ? "rgba(255,255,255,0.06)" : pressed ? "rgba(255,255,255,0.03)" : "transparent",
                      borderBottomWidth: i < leaderboard.length - 1 ? 1 : 0,
                      borderBottomColor: border,
                    })}
                  >
                    <View style={{ width: 28, alignItems: "center" }}>
                      {i < 3 ? (
                        <Text style={{ fontSize: 20 }}>{MEDAL[i]}</Text>
                      ) : (
                        <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: entry.isMe ? text : muted }}>
                          {i + 1}
                        </Text>
                      )}
                    </View>

                    <Avatar initials={entry.initials} color={entry.color} size={44}
                      borderWidth={entry.isMe ? 2 : 0} borderColor="#ffffff" />

                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: entry.isMe ? "Manrope-ExtraBold" : "Manrope-SemiBold", fontSize: 15, color: text }}>
                        {entry.isMe ? `${entry.name} (you)` : entry.name}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                        <Flame size={11} color="#f97316" />
                        <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                          {entry.streak ?? 0} day streak
                        </Text>
                      </View>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ ...(DOT as any), fontSize: 20, color: text }}>
                        {(entry.points ?? 0).toLocaleString()}
                      </Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted }}>pts</Text>
                    </View>
                  </Pressable>
                ))}
                {leaderboard.length <= 1 && (
                  <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
                    <Trophy size={28} color={muted} strokeWidth={1.5} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted, textAlign: "center" }}>
                      Add friends to compete on the leaderboard
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* How points work */}
            <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16 }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 12 }}>
                HOW POINTS WORK
              </Text>
              {HOW_POINTS.map((row, i) => (
                <View key={i} style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingVertical: 9, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: border,
                }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <row.icon size={15} color={muted} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>{row.label}</Text>
                  </View>
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 13, color: LIME }}>{row.pts} pts</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ════════════ CHALLENGES ════════════ */}
        {tab === "Challenges" && (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <Pressable
              onPress={() => Alert.alert("Start a Challenge", "Coming soon!")}
              style={({ pressed }) => ({
                borderWidth: 1.5, borderStyle: "dashed", borderColor: "#333333",
                borderRadius: 18, paddingVertical: 16,
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Plus size={16} color={muted} />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>
                Start a challenge with friends
              </Text>
            </Pressable>

            <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 32, alignItems: "center", gap: 10 }}>
              <Trophy size={32} color={muted} strokeWidth={1.5} />
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, textAlign: "center" }}>
                Challenges coming soon!{"\n"}Add friends to get started.
              </Text>
            </View>
          </View>
        )}

      </ScrollView>

      {/* ── Add / Invite Modal ── */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <Pressable onPress={closeModal} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)" }} />
          <View style={{
            backgroundColor: "#141414", borderTopLeftRadius: 28, borderTopRightRadius: 28,
            borderWidth: 1, borderColor: border, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
          }}>
            {/* Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: text }}>
                {modalTab === "add" ? "Add Friend" : "Invite to FitCore"}
              </Text>
              <Pressable onPress={closeModal} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <X size={22} color={muted} />
              </Pressable>
            </View>

            {/* Tab switcher */}
            <View style={{
              flexDirection: "row", backgroundColor: "#1e1e1e", borderRadius: 14,
              padding: 4, marginBottom: 20,
            }}>
              {(["add", "invite"] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => {
                    setModalTab(t);
                    setAddError(""); setInviteError(""); setInviteSent(false);
                  }}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: "center",
                    backgroundColor: modalTab === t ? "#ffffff" : "transparent",
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{
                    fontFamily: "Manrope-Bold", fontSize: 13,
                    color: modalTab === t ? "#0a0a0a" : muted,
                  }}>
                    {t === "add" ? "Add Friend" : "Invite"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* ── ADD FRIEND tab ── */}
            {modalTab === "add" && (
              <>
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginBottom: 12 }}>
                  Enter the email address of someone already on FitCore.
                </Text>
                <TextInput
                  value={addEmail}
                  onChangeText={t => { setAddEmail(t); setAddError(""); }}
                  placeholder="friend@email.com"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{
                    backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14,
                    fontFamily: "Manrope", fontSize: 15, color: text,
                    borderWidth: 1, borderColor: addError ? "#ef4444" : border, marginBottom: 8,
                  }}
                />
                {addError ? <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#ef4444", marginBottom: 10 }}>{addError}</Text> : null}
                <Pressable
                  onPress={() => {
                    if (!addEmail.trim()) { setAddError("Enter an email address"); return; }
                    sendRequestMutation.mutate(addEmail.trim().toLowerCase());
                  }}
                  disabled={sendRequestMutation.isPending}
                  style={({ pressed }) => ({
                    backgroundColor: LIME, borderRadius: 14, paddingVertical: 16,
                    alignItems: "center", marginTop: 8,
                    opacity: pressed || sendRequestMutation.isPending ? 0.7 : 1,
                  })}
                >
                  {sendRequestMutation.isPending
                    ? <ActivityIndicator color="#0a0a0a" />
                    : <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: "#0a0a0a" }}>Send Friend Request</Text>}
                </Pressable>
                <Pressable onPress={() => setModalTab("invite")} style={{ marginTop: 14, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                    Not on FitCore yet? <Text style={{ color: LIME, fontFamily: "Manrope-Bold" }}>Send an invite →</Text>
                  </Text>
                </Pressable>
              </>
            )}

            {/* ── INVITE tab ── */}
            {modalTab === "invite" && (
              <>
                {inviteSent ? (
                  /* Success state */
                  <View style={{ alignItems: "center", paddingVertical: 24, gap: 12 }}>
                    <View style={{
                      width: 64, height: 64, borderRadius: 32,
                      backgroundColor: "#052e16", borderWidth: 1.5, borderColor: "#22c55e",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      <Send size={28} color="#22c55e" />
                    </View>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: "#22c55e" }}>Invitation sent!</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, textAlign: "center" }}>
                      Your invite was sent to {inviteContact}.
                      They'll get a link to join FitCore.
                    </Text>
                    <Pressable
                      onPress={() => { setInviteContact(""); setInviteNote(""); setInviteSent(false); }}
                      style={({ pressed }) => ({
                        backgroundColor: "#1e1e1e", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24,
                        borderWidth: 1, borderColor: border, marginTop: 8,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>Send another</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginBottom: 14 }}>
                      Invite someone who isn't on FitCore yet. They'll receive a link to create an account.
                    </Text>

                    {/* Email / SMS toggle */}
                    <View style={{
                      flexDirection: "row", gap: 10, marginBottom: 16,
                    }}>
                      {(["email", "sms"] as const).map(m => {
                        const selected = inviteMethod === m;
                        const Icon = m === "email" ? Mail : Smartphone;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => { setInviteMethod(m); setInviteContact(""); setInviteError(""); }}
                            style={({ pressed }) => ({
                              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                              gap: 7, paddingVertical: 11, borderRadius: 14,
                              backgroundColor: selected ? "#1e3a5f" : "#1a1a1a",
                              borderWidth: 1.5, borderColor: selected ? "#9bd1ff" : border,
                              opacity: pressed ? 0.8 : 1,
                            })}
                          >
                            <Icon size={15} color={selected ? "#9bd1ff" : muted} />
                            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: selected ? "#9bd1ff" : muted }}>
                              {m === "email" ? "Email" : "Text (SMS)"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Contact input */}
                    <TextInput
                      value={inviteContact}
                      onChangeText={t => { setInviteContact(t); setInviteError(""); }}
                      placeholder={inviteMethod === "email" ? "friend@email.com" : "555-867-5309"}
                      placeholderTextColor="#555"
                      autoCapitalize="none"
                      keyboardType={inviteMethod === "email" ? "email-address" : "phone-pad"}
                      style={{
                        backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14,
                        fontFamily: "Manrope", fontSize: 15, color: text,
                        borderWidth: 1, borderColor: inviteError ? "#ef4444" : border, marginBottom: 8,
                      }}
                    />

                    {/* Personal note */}
                    <TextInput
                      value={inviteNote}
                      onChangeText={setInviteNote}
                      placeholder="Add a personal note… (optional)"
                      placeholderTextColor="#555"
                      multiline
                      maxLength={280}
                      style={{
                        backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14,
                        fontFamily: "Manrope", fontSize: 14, color: text,
                        borderWidth: 1, borderColor: border, marginBottom: 8,
                        minHeight: 72, textAlignVertical: "top",
                      }}
                    />
                    <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, textAlign: "right", marginBottom: 12 }}>
                      {inviteNote.length}/280
                    </Text>

                    {inviteError ? (
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#ef4444", marginBottom: 10 }}>{inviteError}</Text>
                    ) : null}

                    <Pressable
                      disabled={sendInviteMutation.isPending}
                      onPress={() => {
                        const contact = inviteContact.trim();
                        if (!contact) { setInviteError(`Enter a${inviteMethod === "email" ? "n email address" : " phone number"}`); return; }
                        sendInviteMutation.mutate({
                          method: inviteMethod,
                          contact,
                          personalNote: inviteNote.trim() || undefined,
                        });
                      }}
                      style={({ pressed }) => ({
                        backgroundColor: LIME, borderRadius: 14, paddingVertical: 16,
                        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                        opacity: pressed || sendInviteMutation.isPending ? 0.7 : 1,
                      })}
                    >
                      {sendInviteMutation.isPending
                        ? <ActivityIndicator color="#0a0a0a" />
                        : <>
                            <Send size={16} color="#0a0a0a" />
                            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: "#0a0a0a" }}>
                              Send {inviteMethod === "email" ? "Email" : "Text"} Invite
                            </Text>
                          </>}
                    </Pressable>
                  </>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}
