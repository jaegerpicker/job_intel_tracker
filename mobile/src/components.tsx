import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
export const colors = {
  ink: "#162C2C",
  muted: "#506866",
  paper: "#F4F6F1",
  card: "#FFFFFF",
  green: "#245A48",
  line: "#D9E2D9",
  amber: "#795115",
};
export function Button({
  label,
  onPress,
  disabled = false,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        quiet && styles.quiet,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.buttonText, quiet && { color: colors.green }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        style={[
          styles.input,
          multiline && { minHeight: 120, textAlignVertical: "top" },
        ]}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}
export function Notice({ text }: { text: string }) {
  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  container: { width: "100%", maxWidth: 760, alignSelf: "center", flex: 1 },
  header: { padding: 24, paddingBottom: 16, gap: 8 },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    color: colors.green,
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 16, lineHeight: 23, color: colors.muted },
  text: { fontSize: 16, lineHeight: 24, color: colors.ink },
  card: {
    padding: 20,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: colors.ink },
  label: { fontSize: 14, fontWeight: "600", color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: colors.green,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  quiet: { backgroundColor: "#E4EDE3" },
  buttonText: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    minHeight: 50,
  },
  field: { gap: 8, marginVertical: 10 },
  notice: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#F2E9D4",
    marginBottom: 12,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: "#E6EBE3",
    marginRight: 8,
  },
  chipSelected: { backgroundColor: colors.green },
  chipText: { color: colors.ink, fontWeight: "600" },
  section: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 14,
    marginTop: 10,
  },
  badge: { color: colors.green, fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 24, paddingBottom: 40 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 16 },
});
