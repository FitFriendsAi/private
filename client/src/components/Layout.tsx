import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, Dumbbell, TrendingUp, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { path: "/",         label: "Home",    icon: LayoutDashboard },
  { path: "/food",     label: "Food",    icon: UtensilsCrossed },
  { path: "/workouts", label: "Train",   icon: Dumbbell },
  { path: "/friends",  label: "Friends", icon: Users },
  { path: "/progress", label: "Progress",icon: TrendingUp },
  { path: "/settings", label: "Settings",icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto relative">
      <main className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 px-3 pb-3">
        <div
          className="flex items-center justify-around py-2 px-1 shadow-2xl"
          style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 24,
          }}
        >
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = location === path;
            return (
              <Link key={path} href={path}>
                <a className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-2xl transition-all min-w-[3rem]">
                  <Icon
                    className="w-5 h-5 transition-colors"
                    style={{ color: active ? "var(--pink)" : "hsl(var(--muted-foreground))" }}
                  />
                  <span
                    className="text-[10px] font-bold tracking-wide uppercase transition-colors"
                    style={{ color: active ? "var(--pink)" : "hsl(var(--muted-foreground))" }}
                  >
                    {label}
                  </span>
                </a>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
