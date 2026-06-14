/**
 * CelebrationModal — full-screen overlay for PR / streak milestones.
 * Spring scale-in, title + list of celebration lines, single dismiss button.
 */
import { useRef, useEffect } from "react";
import { View, Text, Pressable, Modal, Animated } from "react-native";

const LIME = "#C8E84C";

interface Props {
  visible: boolean;
  title: string;
  lines: string[];
  onDismiss: () => void;
}

export function CelebrationModal({ visible, title, lines, onDismiss }: Props) {
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.7);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 9 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Animated.View style={{
          width: "100%", maxWidth: 360,
          backgroundColor: "#1a1a1a", borderRadius: 24, padding: 28,
          borderWidth: 1, borderColor: "rgba(200,232,76,0.3)",
          alignItems: "center",
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        }}>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: LIME, marginBottom: 16, textAlign: "center" }}>
            {title}
          </Text>
          {lines.map((line, i) => (
            <Text key={i} style={{
              fontFamily: "Manrope-SemiBold", fontSize: 15, color: "#ffffff",
              textAlign: "center", marginBottom: 6, lineHeight: 22,
            }}>
              {line}
            </Text>
          ))}
          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => ({
              marginTop: 20, backgroundColor: LIME, borderRadius: 14,
              paddingVertical: 12, paddingHorizontal: 36,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: "#0a0a0a" }}>Nice!</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
