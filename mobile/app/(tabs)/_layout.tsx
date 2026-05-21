import { Tabs, Redirect } from "expo-router";
import { View, ActivityIndicator, Platform } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { Home, UtensilsCrossed, Dumbbell, Users, TrendingUp, Settings, Target } from "lucide-react-native";

function TabIcon({ Icon, color }: { Icon: any; color: string }) {
  return <Icon size={22} color={color} strokeWidth={2} />;
}

export default function TabLayout() {
  const { user, loading } = useAuth();
  const { palette } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.bg }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: palette.tabBar,
          borderTopColor: palette.cardBorder,
          borderTopWidth: 1,
          height: Platform.OS === "web" ? 72 : 84,
          paddingBottom: Platform.OS === "web" ? 10 : 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: "#ffffff",
        tabBarInactiveTintColor: "#999999",
        tabBarLabelStyle: {
          fontFamily: "Manrope-SemiBold",
          fontSize: 10,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon Icon={Home} color={color} />,
        }}
      />
      <Tabs.Screen
        name="food"
        options={{
          title: "Food",
          tabBarIcon: ({ color }) => <TabIcon Icon={UtensilsCrossed} color={color} />,
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: "Train",
          tabBarIcon: ({ color }) => <TabIcon Icon={Dumbbell} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: "Friends",
          tabBarIcon: ({ color }) => <TabIcon Icon={Users} color={color} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: ({ color }) => <TabIcon Icon={Target} color={color} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: ({ color }) => <TabIcon Icon={TrendingUp} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <TabIcon Icon={Settings} color={color} />,
        }}
      />
    </Tabs>
  );
}
