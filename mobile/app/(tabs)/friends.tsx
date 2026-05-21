import { useState } from "react";
import {
  View, Text, ScrollView, Pressable, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import {
  Plus, Heart, MessageCircle, Flame, Dumbbell,
  Target, Zap, Check, UserPlus, Trophy,
} from "lucide-react-native";

const LIME  = "#c8e84c";
const DOT: object = { fontFamily: "Doto" };

// ── Mock data ──────────────────────────────────────────────────────
const FRIENDS = [
  { id: 1, initials: "A",  firstName: "Alex",   lastName: "M.", streak: 18, pts: 4820, color: "#f8c8dc" },
  { id: 2, initials: "S",  firstName: "Sam",    lastName: "K.", streak: 14, pts: 4310, color: "#c8e84c" },
  { id: 3, initials: "R",  firstName: "Riley",  lastName: "T.", streak: 11, pts: 3990, color: "#ffb88c" },
  { id: 4, initials: "J",  firstName: "Jordan", lastName: "L.", streak:  7, pts: 3420, color: "#9bd1ff" },
  { id: 5, initials: "C",  firstName: "Casey",  lastName: "R.", streak:  5, pts: 2980, color: "#d3a8ff" },
];

const FEED_POSTS = [
  {
    id: 1, friend: FRIENDS[0], timeAgo: "2h ago",
    title: "Push Day PR! 🔥",
    body: "Finally hit 225 on bench. Months of work paying off!",
    stat: { label: "BENCH PRESS", value: "225", unit: "lbs", bg: "#ffffff", labelColor: "#555", valueColor: "#0a0a0a" },
    likes: 12, comments: 3, reactions: ["🔥", "💪", "🤩"],
  },
  {
    id: 2, friend: FRIENDS[1], timeAgo: "5h ago",
    title: "Meal prepped for the week",
    body: "Hit 185g protein every single day this week. Clean eating is a superpower.",
    stat: { label: "WEEKLY PROTEIN", value: "185", unit: "g avg", bg: LIME, labelColor: "rgba(0,0,0,0.55)", valueColor: "#0a0a0a" },
    likes: 8, comments: 1, reactions: ["💚", "🥗"],
  },
  {
    id: 3, friend: FRIENDS[3], timeAgo: "1d ago",
    title: "Rest day but still hitting steps 🚶",
    body: "12,000 steps, mobility work, and actually got 8 hours of sleep. Recovery is training.",
    stat: null,
    likes: 5, comments: 0, reactions: ["😴", "👣"],
  },
  {
    id: 4, friend: FRIENDS[2], timeAgo: "2d ago",
    title: "New squat PB 🏋️",
    body: "315 lbs for 3 reps. Lower body is catching up finally.",
    stat: { label: "BACK SQUAT", value: "315", unit: "lbs", bg: "#ffffff", labelColor: "#555", valueColor: "#0a0a0a" },
    likes: 19, comments: 6, reactions: ["🔥", "💪"],
  },
];

const CHALLENGES = [
  {
    id: 1,
    icon: "flame", iconColor: "#f97316", iconBg: "rgba(249,115,22,0.15)",
    title: "30-Day Streak",
    desc: "Log a workout every day for 30 days",
    progress: 9, goal: 30,
    accentColor: "#ffffff",
    participants: [FRIENDS[0], FRIENDS[1], FRIENDS[3]],
    daysLeft: 21, joined: true,
  },
  {
    id: 2,
    icon: "target", iconColor: LIME, iconBg: "rgba(200,232,76,0.15)",
    title: "Protein King",
    desc: "Hit your protein target 20 days this month",
    progress: 12, goal: 20,
    accentColor: LIME,
    participants: [FRIENDS[1], FRIENDS[4]],
    daysLeft: 8, joined: true,
  },
  {
    id: 3,
    icon: "dumbbell", iconColor: "#9bd1ff", iconBg: "rgba(155,209,255,0.15)",
    title: "100k Volume Club",
    desc: "Lift 100,000 lbs total this month",
    progress: 0, goal: 100,
    accentColor: "#9bd1ff",
    participants: [FRIENDS[0], FRIENDS[2], FRIENDS[3], FRIENDS[4]],
    daysLeft: 13, joined: false,
  },
];

const HOW_POINTS = [
  { icon: Dumbbell, label: "Log a workout",       pts: "+100" },
  { icon: Target,   label: "Hit macro targets",    pts: "+50"  },
  { icon: Flame,    label: "Daily streak bonus",   pts: "+25"  },
  { icon: Zap,      label: "Set a personal record",pts: "+200" },
];

// ── Avatar circle ──────────────────────────────────────────────────
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

// ── Challenge icon helper ──────────────────────────────────────────
function ChallengeIcon({ name, color, bg }: { name: string; color: string; bg: string }) {
  const Icon = name === "flame" ? Flame : name === "target" ? Target : Dumbbell;
  return (
    <View style={{
      width: 46, height: 46, borderRadius: 14,
      backgroundColor: bg, alignItems: "center", justifyContent: "center",
    }}>
      <Icon size={22} color={color} />
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────
const TABS = ["Feed", "Leaderboard", "Challenges"] as const;
type Tab = typeof TABS[number];

export default function FriendsScreen() {
  const { palette } = useTheme();
  const { user }    = useAuth();
  const { card, cardBorder: border, text, muted, bg } = palette;
  const [tab, setTab] = useState<Tab>("Feed");

  const myInitial = (user?.name?.[0] ?? "Y").toUpperCase();
  const MY_PTS    = 3750;
  const MY_STREAK = 9;

  // Full leaderboard including "me"
  const leaderboard = [
    ...FRIENDS,
    { id: 0, initials: myInitial, firstName: "You", lastName: "(you)", streak: MY_STREAK, pts: MY_PTS, color: "#ffffff", isMe: true },
  ].sort((a, b) => b.pts - a.pts);

  const myRank   = leaderboard.findIndex((e: any) => e.isMe) + 1;
  const above    = leaderboard[myRank - 2]; // person one rank above me
  const ptsToNext = above ? above.pts - MY_PTS : 0;
  const ptsProgress = above ? MY_PTS / above.pts : 1;
  const MEDAL = ["🥇", "🥈", "🥉"];

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
          onPress={() => Alert.alert("Add Friends", "Coming soon!")}
          style={({ pressed }) => ({
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: "#1e1e1e", borderWidth: 1, borderColor: border,
            alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1,
          })}
        >
          <UserPlus size={18} color={text} />
        </Pressable>
      </View>

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

        {/* ════════════════ FEED ════════════════ */}
        {tab === "Feed" && (
          <View>
            {/* Stories row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 14 }}
            >
              {/* Share (you) */}
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

              {/* Friend stories */}
              {FRIENDS.map(f => (
                <Pressable key={f.id} style={{ alignItems: "center", gap: 6 }}>
                  <View style={{
                    width: 64, height: 64, borderRadius: 32,
                    borderWidth: 2.5, borderColor: f.color,
                    padding: 2, alignItems: "center", justifyContent: "center",
                  }}>
                    <Avatar initials={f.initials} color={f.color} size={54} />
                  </View>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: text }}>
                    {f.firstName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Posts */}
            <View style={{ paddingHorizontal: 16, gap: 12 }}>
              {FEED_POSTS.map(post => (
                <View key={post.id} style={{
                  backgroundColor: card, borderRadius: 20,
                  borderWidth: 1, borderColor: border, padding: 16,
                }}>
                  {/* Post header */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <Avatar initials={post.friend.initials} color={post.friend.color} size={40} />
                    <View>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>
                        {post.friend.firstName} {post.friend.lastName}
                      </Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted }}>{post.timeAgo}</Text>
                    </View>
                  </View>

                  {/* Title + body */}
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: text, marginBottom: 4 }}>
                    {post.title}
                  </Text>
                  <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, lineHeight: 19, marginBottom: 12 }}>
                    {post.body}
                  </Text>

                  {/* Stat highlight card */}
                  {post.stat && (
                    <View style={{
                      backgroundColor: post.stat.bg, borderRadius: 14,
                      paddingHorizontal: 16, paddingVertical: 14,
                      flexDirection: "row", alignItems: "center",
                      justifyContent: "space-between", marginBottom: 14,
                    }}>
                      <Text style={{
                        fontFamily: "Manrope-ExtraBold", fontSize: 10,
                        color: post.stat.labelColor, letterSpacing: 0.8,
                      }}>
                        {post.stat.label}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                        <Text style={{ ...(DOT as any), fontSize: 28, color: post.stat.valueColor }}>
                          {post.stat.value}
                        </Text>
                        <Text style={{
                          fontFamily: "Manrope-SemiBold", fontSize: 13, color: post.stat.labelColor,
                        }}>
                          {post.stat.unit}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Reactions row */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", gap: 16 }}>
                      <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Heart size={16} color={muted} />
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                          {post.likes}
                        </Text>
                      </Pressable>
                      <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <MessageCircle size={16} color={muted} />
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                          {post.comments}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      {post.reactions.map((r, i) => (
                        <Text key={i} style={{ fontSize: 18 }}>{r}</Text>
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ════════════════ LEADERBOARD ════════════════ */}
        {tab === "Leaderboard" && (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>

            {/* Your rank card (white) */}
            <View style={{
              backgroundColor: "#ffffff", borderRadius: 20, padding: 18,
            }}>
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
                  <View style={{
                    backgroundColor: "#eeeeee", borderRadius: 20,
                    paddingHorizontal: 12, paddingVertical: 6,
                  }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#444444" }}>
                      {ptsToNext.toLocaleString()} pts to #{myRank - 1}
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <Text style={{ ...(DOT as any), fontSize: 24, color: "#0a0a0a" }}>
                  {MY_PTS.toLocaleString()}
                </Text>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#666666" }}>pts</Text>
              </View>

              {/* Progress bar */}
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                  <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "#888888" }}>
                    Progress to next rank
                  </Text>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#333333" }}>
                    {Math.round(ptsProgress * 100)}%
                  </Text>
                </View>
                <View style={{ height: 6, backgroundColor: "#e0e0e0", borderRadius: 3 }}>
                  <View style={{
                    height: 6, borderRadius: 3, backgroundColor: "#0a0a0a",
                    width: `${Math.min(ptsProgress * 100, 100)}%`,
                  }} />
                </View>
              </View>
            </View>

            {/* Leaderboard list */}
            <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, overflow: "hidden" }}>
              {leaderboard.map((entry: any, i) => (
                <View key={entry.id} style={{
                  flexDirection: "row", alignItems: "center", padding: 14, gap: 12,
                  backgroundColor: entry.isMe ? "rgba(255,255,255,0.06)" : "transparent",
                  borderBottomWidth: i < leaderboard.length - 1 ? 1 : 0,
                  borderBottomColor: border,
                }}>
                  {/* Rank */}
                  <View style={{ width: 28, alignItems: "center" }}>
                    {i < 3 ? (
                      <Text style={{ fontSize: 20 }}>{MEDAL[i]}</Text>
                    ) : (
                      <Text style={{
                        fontFamily: "Manrope-ExtraBold", fontSize: 16,
                        color: entry.isMe ? text : muted,
                      }}>
                        {i + 1}
                      </Text>
                    )}
                  </View>

                  {/* Avatar */}
                  <Avatar
                    initials={entry.initials}
                    color={entry.color}
                    size={44}
                    borderWidth={entry.isMe ? 2 : 0}
                    borderColor="#ffffff"
                  />

                  {/* Name + streak */}
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: entry.isMe ? "Manrope-ExtraBold" : "Manrope-SemiBold",
                      fontSize: 15, color: text,
                    }}>
                      {entry.firstName} {entry.lastName}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                      <Flame size={11} color="#f97316" />
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                        {entry.streak} day streak
                      </Text>
                    </View>
                  </View>

                  {/* Points */}
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ ...(DOT as any), fontSize: 20, color: text }}>
                      {entry.pts.toLocaleString()}
                    </Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted }}>pts</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* How points work */}
            <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16 }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8, marginBottom: 12 }}>
                HOW POINTS WORK
              </Text>
              {HOW_POINTS.map((row, i) => (
                <View key={i} style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingVertical: 9,
                  borderTopWidth: i > 0 ? 1 : 0, borderTopColor: border,
                }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <row.icon size={15} color={muted} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: text }}>
                      {row.label}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 13, color: LIME }}>
                    {row.pts} pts
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ════════════════ CHALLENGES ════════════════ */}
        {tab === "Challenges" && (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>

            {/* Start a challenge CTA */}
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

            {/* Challenge cards */}
            {CHALLENGES.map(ch => {
              const pct = ch.goal > 0 ? Math.round((ch.progress / ch.goal) * 100) : 0;
              return (
                <View key={ch.id} style={{
                  backgroundColor: card, borderRadius: 20,
                  borderWidth: 1, borderColor: border, padding: 16,
                  borderTopWidth: 3, borderTopColor: ch.joined ? ch.accentColor : border,
                }}>
                  {/* Top row: icon + title */}
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <ChallengeIcon name={ch.icon} color={ch.iconColor} bg={ch.iconBg} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: text }}>
                        {ch.title}
                      </Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>
                        {ch.desc}
                      </Text>
                    </View>
                  </View>

                  {/* Progress bar */}
                  {ch.joined && (
                    <View style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted }}>
                          {ch.progress} / {ch.goal}
                        </Text>
                        <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 12, color: ch.accentColor }}>
                          {pct}%
                        </Text>
                      </View>
                      <View style={{ height: 6, backgroundColor: "#222222", borderRadius: 3 }}>
                        <View style={{
                          height: 6, borderRadius: 3,
                          backgroundColor: ch.accentColor,
                          width: `${pct}%`,
                        }} />
                      </View>
                    </View>
                  )}

                  {/* Bottom row: participants + days left + join button */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {/* Stacked avatars */}
                      <View style={{ flexDirection: "row" }}>
                        {ch.participants.slice(0, 4).map((p, i) => (
                          <View key={p.id} style={{
                            marginLeft: i > 0 ? -8 : 0, zIndex: ch.participants.length - i,
                          }}>
                            <Avatar
                              initials={p.initials} color={p.color} size={26}
                              borderWidth={1.5} borderColor={card}
                            />
                          </View>
                        ))}
                      </View>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                        {ch.participants.length} joined
                      </Text>
                      <Text style={{ color: muted, fontSize: 10 }}>·</Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                        {ch.daysLeft}d left
                      </Text>
                    </View>

                    {/* Join / Joined button */}
                    <Pressable
                      onPress={() => Alert.alert(ch.joined ? "Already joined!" : `Join "${ch.title}"?`)}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", gap: 5,
                        backgroundColor: ch.joined ? "rgba(255,255,255,0.07)" : ch.accentColor,
                        borderRadius: 14, paddingHorizontal: 14, paddingVertical: 7,
                        opacity: pressed ? 0.75 : 1,
                      })}
                    >
                      {ch.joined && <Check size={13} color={ch.accentColor} />}
                      <Text style={{
                        fontFamily: "Manrope-Bold", fontSize: 13,
                        color: ch.joined ? ch.accentColor : "#0a0a0a",
                      }}>
                        {ch.joined ? "Joined" : "Join"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
