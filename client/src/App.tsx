import { Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import FoodLog from "@/pages/FoodLog";
import Workouts from "@/pages/Workouts";
import Goals from "@/pages/Goals";
import Progress from "@/pages/Progress";
import Friends from "@/pages/Friends";
import Settings from "@/pages/Settings";

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Auth />;

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/food" component={FoodLog} />
        <Route path="/workouts" component={Workouts} />
        <Route path="/goals" component={Goals} />
        <Route path="/friends" component={Friends} />
        <Route path="/progress" component={Progress} />
        <Route path="/settings" component={Settings} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>
  );
}
