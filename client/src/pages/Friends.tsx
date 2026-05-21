import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  Heart, MessageCircle, Share2, Trophy, Flame, Dumbbell,
  ChevronRight, Plus, Users, Zap, Target, Check,
} from "lucide-react";

/* ── Mock data ─────────────────────────────────────────────── */
const STORIES = [
  { id: 1, name: "Alex",   avatar: "A", color: "#f8c8dc", ring: "#ff6eb4" },
  { id: 2, name: "Sam",    avatar: "S", color: "#c8e84c", ring: "#a0c030" },
  { id: 3, name: "Jordan", avatar: "J", color: "#9bd1ff", ring: "#4aabff" },
  { id: 4, name: "Casey",  avatar: "C", color: "#d3a8ff", ring: "#b070ff" },
  { id: 5, name: "Riley",  avatar: "R", color: "#ffb88c", ring: "#ff8c4a" },
];

const FEED_POSTS = [
  {
    id: 1,
    user: { name: "Alex M.", avatar: "A", color: "#f8c8dc" },
    timeAgo: "2h ago",
    title: "Push Day PR! 🔥",
    body: "Finally hit 225 on bench. Months of work paying off!",
    stats: { label: "BENCH PRESS", value: "225", unit: "lbs", accent: "pink" },
    likes: 12, comments: 3, reactions: ["🔥","💪","👏"],
  },
  {
    id: 2,
    user: { name: "Sam K.", avatar: "S", color: "#c8e84c" },
    timeAgo: "5h ago",
    title: "Meal prepped for the week",
    body: "Hit 185g protein every single day this week. Clean eating is a superpower.",
    stats: { label: "WEEKLY PROTEIN", value: "185", unit: "g avg", accent: "lime" },
    likes: 8, comments: 1, reactions: ["💚","🥗"],
  },
  {
    id: 3,
    user: { name: "Jordan L.", avatar: "J", color: "#9bd1ff" },
    timeAgo: "1d ago",
    title: "Rest day but still hitting steps 🚶",
    body: "12,000 steps, mobility work, and actually got 8 hours of sleep. Recovery is training.",
    stats: null,
    likes: 15, comments: 5, reactions: ["😴","✨","❤️"],
  },
  {
    id: 4,
    user: { name: "Casey R.", avatar: "C", color: "#d3a8ff" },
    timeAgo: "1d ago",
    title: "5K in under 25 mins",
    body: "New cardio PB! Started running 3 months ago and can't believe how far I've come.",
    stats: { label: "5K TIME", value: "24:38", unit: "mm:ss", accent: "pink" },
    likes: 21, comments: 8, reactions: ["🏃","🎉","🔥"],
  },
];

const LEADERBOARD = [
  { rank: 1, name: "Alex M.",   avatar: "A", color: "#f8c8dc", score: 4820, streak: 18, medal: "🥇" },
  { rank: 2, name: "Sam K.",    avatar: "S", color: "#c8e84c", score: 4310, streak: 14, medal: "🥈" },
  { rank: 3, name: "Riley T.",  avatar: "R", color: "#ffb88c", score: 3990, streak: 11, medal: "🥉" },
  { rank: 4, name: "You",       avatar: "Y", color: "#ffffff", score: 3750, streak: 9,  medal: null, isYou: true },
  { rank: 5, name: "Jordan L.", avatar: "J", color: "#9bd1ff", score: 3420, streak: 7,  medal: null },
  { rank: 6, name: "Casey R.",  avatar: "C", color: "#d3a8ff", score: 2980, streak: 5,  medal: null },
];

const CHALLENGES = [
  {
    id: 1,
    title: "30-Day Streak",
    description: "Log a workout every day for 30 days",
    icon: Flame,
    accentColor: "var(--pink)",
    progress: 9, total: 30,
    participants: ["A", "S", "J"],
    daysLeft: 21,
    joined: true,
  },
  {
    id: 2,
    title: "Protein King",
    description: "Hit your protein target 20 days this month",
    icon: Target,
    accentColor: "var(--lime)",
    progress: 12, total: 20,
    participants: ["S", "C"],
    daysLeft: 8,
    joined: true,
  },
  {
    id: 3,
    title: "100k Volume Club",
    description: "Lift 100,000 lbs total this month",
    icon: Dumbbell,
    accentColor: "#9bd1ff",
    progress: 68420, total: 100000,
    participants: ["A", "R", "J", "C"],
    daysLeft: 13,
    joined: false,
  },
];

/* ── Sub-components ─────────────────────────────────────────── */

function Avatar({ letter, color, size = 40 }: { letter: string; color: string; size?: number }) {
  const isDark = color === "#c8e84c" || color === "#ffffff" || color === "#ffb88c";
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: size * 0.4,
        color: isDark ? "#0a0a0a" : "#0a0a0a",
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

function StoriesRow() {
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "flex", gap: 12, padding: "4px 0" }}>
        {/* Share / Add story */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            border: "2px dashed hsl(var(--border))",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}>
            <Plus style={{ width: 20, height: 20, color: "hsl(var(--muted-foreground))" }} />
          </div>
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>Share</span>
        </div>

        {STORIES.map(s => (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <div style={{
              width: 60, height: 60, borderRadius: "50%",
              padding: 2,
              background: `linear-gradient(135deg, ${s.ring}, ${s.color})`,
            }}>
              <div style={{
                width: "100%", height: "100%", borderRadius: "50%",
                padding: 2,
                background: "hsl(var(--background))",
              }}>
                <Avatar letter={s.avatar} color={s.color} size={48} />
              </div>
            </div>
            <span style={{ fontSize: 10, color: "hsl(var(--foreground))", fontWeight: 600 }}>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: typeof FEED_POSTS[number] }) {
  const [liked, setLiked] = useState(false);
  const accentColor = post.stats?.accent === "lime" ? "var(--lime)" : "var(--pink)";
  const accentText = post.stats?.accent === "lime" ? "#0a0a0a" : "#0a0a0a";

  return (
    <div style={{
      background: "hsl(var(--card))",
      borderRadius: 20,
      padding: 16,
      border: "1px solid hsl(var(--border))",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Avatar letter={post.user.avatar} color={post.user.color} size={38} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{post.user.name}</div>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{post.timeAgo}</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{post.title}</div>
      <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginBottom: 12 }}>{post.body}</div>

      {/* Stats block */}
      {post.stats && (
        <div style={{
          background: accentColor, borderRadius: 14, padding: "12px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: accentText, letterSpacing: "0.05em" }}>
            {post.stats.label}
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span className="dot" style={{ fontSize: 26, color: accentText, lineHeight: 1 }}>
              {post.stats.value}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: accentText }}>{post.stats.unit}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={() => setLiked(l => !l)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer",
            color: liked ? "var(--pink)" : "hsl(var(--muted-foreground))",
            fontSize: 13, fontWeight: 600,
          }}
        >
          <Heart style={{ width: 15, height: 15, fill: liked ? "var(--pink)" : "none" }} />
          {post.likes + (liked ? 1 : 0)}
        </button>
        <button style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "none", border: "none", cursor: "pointer",
          color: "hsl(var(--muted-foreground))", fontSize: 13, fontWeight: 600,
        }}>
          <MessageCircle style={{ width: 15, height: 15 }} />
          {post.comments}
        </button>
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {post.reactions.map((r, i) => (
            <span key={i} style={{ fontSize: 16 }}>{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StoriesRow />
      {FEED_POSTS.map(post => <PostCard key={post.id} post={post} />)}
    </div>
  );
}

function LeaderboardTab() {
  const myEntry = LEADERBOARD.find(l => l.isYou);
  const myRank = myEntry?.rank ?? 0;
  const myScore = myEntry?.score ?? 0;
  const nextEntry = LEADERBOARD.find(l => l.rank === myRank - 1);
  const gap = nextEntry ? nextEntry.score - myScore : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Your score card */}
      <div style={{
        background: "var(--pink)", borderRadius: 20, padding: 20, color: "#0a0a0a",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>YOUR RANK</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 8 }}>
          <span className="dot" style={{ fontSize: 52, lineHeight: 1, color: "#0a0a0a" }}>#{myRank}</span>
          <span style={{ fontSize: 14, fontWeight: 700, paddingBottom: 6 }}>THIS WEEK</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="dot" style={{ fontSize: 24, color: "#0a0a0a" }}>{myScore.toLocaleString()}</span>
            <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 4 }}>pts</span>
          </div>
          {gap > 0 && (
            <div style={{
              background: "rgba(0,0,0,0.15)", borderRadius: 10, padding: "4px 10px",
              fontSize: 11, fontWeight: 700,
            }}>
              {gap} pts to #{myRank - 1}
            </div>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            <span>Progress to next rank</span>
            <span>{Math.round((myScore / (nextEntry?.score ?? myScore + 1)) * 100)}%</span>
          </div>
          <div style={{ height: 6, background: "rgba(0,0,0,0.2)", borderRadius: 3 }}>
            <div style={{
              height: "100%",
              width: `${Math.round((myScore / (nextEntry?.score ?? myScore + 1)) * 100)}%`,
              background: "#0a0a0a", borderRadius: 3,
            }} />
          </div>
        </div>
      </div>

      {/* Leaderboard rows */}
      <div style={{
        background: "hsl(var(--card))", borderRadius: 20,
        border: "1px solid hsl(var(--border))", overflow: "hidden",
      }}>
        {LEADERBOARD.map((entry, i) => (
          <div
            key={entry.rank}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 16px",
              borderBottom: i < LEADERBOARD.length - 1 ? "1px solid hsl(var(--border))" : "none",
              background: entry.isYou ? "rgba(248,200,220,0.06)" : "transparent",
            }}
          >
            {/* Rank */}
            <div style={{ width: 28, textAlign: "center" }}>
              {entry.medal ? (
                <span style={{ fontSize: 20 }}>{entry.medal}</span>
              ) : (
                <span className="dot" style={{
                  fontSize: 18, color: entry.isYou ? "var(--pink)" : "hsl(var(--muted-foreground))",
                }}>
                  {entry.rank}
                </span>
              )}
            </div>

            <Avatar letter={entry.avatar} color={entry.color} size={36} />

            <div style={{ flex: 1 }}>
              <div style={{
                fontWeight: 700, fontSize: 14,
                color: entry.isYou ? "var(--pink)" : "hsl(var(--foreground))",
              }}>
                {entry.name} {entry.isYou && <span style={{ fontSize: 11, opacity: 0.7 }}>(you)</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                <Flame style={{ width: 11, height: 11, color: "var(--pink)" }} />
                {entry.streak} day streak
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <span className="dot" style={{ fontSize: 20, color: entry.isYou ? "var(--pink)" : "hsl(var(--foreground))" }}>
                {entry.score.toLocaleString()}
              </span>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>pts</div>
            </div>
          </div>
        ))}
      </div>

      {/* Scoring info */}
      <div style={{
        background: "hsl(var(--card))", borderRadius: 16, padding: 14,
        border: "1px solid hsl(var(--border))",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 8, letterSpacing: "0.05em" }}>
          HOW POINTS WORK
        </div>
        {[
          { icon: Dumbbell, label: "Log a workout", pts: "+100 pts" },
          { icon: Target, label: "Hit macro targets", pts: "+50 pts" },
          { icon: Flame, label: "Daily streak bonus", pts: "+25 pts" },
          { icon: Zap, label: "Set a personal record", pts: "+200 pts" },
        ].map(({ icon: Icon, label, pts }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "hsl(var(--foreground))" }}>
              <Icon style={{ width: 13, height: 13, color: "var(--pink)" }} /> {label}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--lime)" }}>{pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChallengeCard({ c }: { c: typeof CHALLENGES[number] }) {
  const [joined, setJoined] = useState(c.joined);
  const pct = c.total > 100
    ? Math.round((c.progress / c.total) * 100)
    : Math.round((c.progress / c.total) * 100);
  const Icon = c.icon;

  const displayProgress = c.total > 100
    ? `${Math.round(c.progress / 1000)}k / ${Math.round(c.total / 1000)}k lbs`
    : `${c.progress} / ${c.total}`;

  return (
    <div style={{
      background: "hsl(var(--card))", borderRadius: 20,
      border: joined ? `1px solid ${c.accentColor}30` : "1px solid hsl(var(--border))",
      padding: 16, overflow: "hidden", position: "relative",
    }}>
      {/* Accent glow strip */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: c.accentColor, opacity: joined ? 1 : 0.3,
      }} />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14,
          background: `${c.accentColor}20`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Icon style={{ width: 22, height: 22, color: c.accentColor }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{c.title}</div>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
            {c.description}
          </div>

          {/* Progress bar */}
          {joined && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                <span style={{ color: "hsl(var(--muted-foreground))" }}>{displayProgress}</span>
                <span style={{ color: c.accentColor }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: "hsl(var(--border))", borderRadius: 3 }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: c.accentColor, borderRadius: 3,
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* Participant avatars */}
            <div style={{ display: "flex", alignItems: "center" }}>
              {c.participants.slice(0, 4).map((p, i) => (
                <div
                  key={i}
                  style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: STORIES.find(s => s.avatar === p)?.color ?? "#888",
                    border: "2px solid hsl(var(--card))",
                    marginLeft: i === 0 ? 0 : -8,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: "#0a0a0a", zIndex: 10 - i,
                  }}
                >
                  {p}
                </div>
              ))}
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginLeft: 6 }}>
                {c.participants.length} joined
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                {c.daysLeft}d left
              </span>
              <button
                onClick={() => setJoined(j => !j)}
                style={{
                  padding: "5px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: joined ? "hsl(var(--border))" : c.accentColor,
                  color: joined ? "hsl(var(--foreground))" : "#0a0a0a",
                  fontSize: 12, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                {joined ? <><Check style={{ width: 11, height: 11 }} /> Joined</> : "Join"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChallengesTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Start a challenge */}
      <button style={{
        width: "100%", padding: "14px 16px", borderRadius: 20,
        border: "2px dashed hsl(var(--border))",
        background: "transparent", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        color: "hsl(var(--muted-foreground))", fontSize: 14, fontWeight: 600,
      }}>
        <Plus style={{ width: 18, height: 18 }} />
        Start a challenge with friends
      </button>

      {CHALLENGES.map(c => <ChallengeCard key={c.id} c={c} />)}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function Friends() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"feed" | "leaderboard" | "challenges">("feed");

  const TABS = [
    { id: "feed" as const,        label: "Feed" },
    { id: "leaderboard" as const, label: "Leaderboard" },
    { id: "challenges" as const,  label: "Challenges" },
  ];

  return (
    <div style={{ padding: "24px 20px 16px", maxWidth: 500, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>Friends</h1>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
            Stay motivated together
          </p>
        </div>
        <button style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "var(--pink)", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Users style={{ width: 18, height: 18, color: "#0a0a0a" }} />
        </button>
      </div>

      {/* Tab selector */}
      <div style={{
        display: "flex", background: "hsl(var(--card))",
        borderRadius: 16, padding: 4, marginBottom: 20,
        border: "1px solid hsl(var(--border))",
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 12, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 700,
              background: tab === t.id ? "var(--pink)" : "transparent",
              color: tab === t.id ? "#0a0a0a" : "hsl(var(--muted-foreground))",
              transition: "all 0.15s ease",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "feed"        && <FeedTab />}
      {tab === "leaderboard" && <LeaderboardTab />}
      {tab === "challenges"  && <ChallengesTab />}
    </div>
  );
}
