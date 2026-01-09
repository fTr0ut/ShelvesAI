// screens/ManualEditScreen.js
import React, { useContext, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import FooterNav from "../components/FooterNav";
import { AuthContext } from "../context/AuthContext";
import { apiRequest } from "../services/api";

export default function ManualEditScreen({ route, navigation }) {
  const { token, apiBase } = useContext(AuthContext);
  const { shelfId, itemId, isCollectable, initialData = {} } = route.params || {};

  // Prefill from initialData
  const [name, setName] = useState(initialData.name || initialData.title || "");
  const [author, setAuthor] = useState(initialData.author || "");
  const [format, setFormat] = useState(initialData.format || "");
  const [position, setPosition] = useState(initialData.position || "");
  const [year, setYear] = useState(initialData.year || "");
  const [publisher, setPublisher] = useState(initialData.publisher || "");
  const [tags, setTags] = useState(
    Array.isArray(initialData.tags) ? initialData.tags.join(", ") : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // In case navigation re-pushes with new params
  useEffect(() => {
    if (!initialData) return;
    setName(initialData.name || initialData.title || "");
    setAuthor(initialData.author || "");
    setFormat(initialData.format || "");
    setPosition(initialData.position || "");
    setYear(initialData.year || "");
    setPublisher(initialData.publisher || "");
    setTags(Array.isArray(initialData.tags) ? initialData.tags.join(", ") : "");
  }, [initialData]);

  const saveChanges = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Name cannot be empty.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const common = {
        name,
        author,
        format,
        position,
        publisher,
        year,
        // normalize tags: comma/space separated → array
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      // If it *is* a collectable (not the pending path), update the collectable
      if (isCollectable && itemId) {
        await apiRequest({
          apiBase,
          path: `/api/collectables/${itemId}`,
          method: "PUT",
          token,
          body: common,
        });
      } else if (itemId) {
        // Manual already linked to the shelf → update it
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/manual/${itemId}`,
          method: "PUT",
          token,
          body: common,
        });
      } else {
        // Pending edit (no itemId yet) → CREATE manual entry with all fields
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/manual`,
          method: "POST",
          token,
          body: {
            ...common,
            // type is required for manual creation; default to whatever came from vision or "manual"
            type: initialData.type || "manual",
            description: initialData.description || "",
          },
        });
      }

      Alert.alert("Success", "Item saved.");
      navigation.goBack();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.header}>Edit Metadata</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor="#9aa6b2"
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Author"
          placeholderTextColor="#9aa6b2"
          value={author}
          onChangeText={setAuthor}
        />

        <TextInput
          style={styles.input}
          placeholder="Publisher"
          placeholderTextColor="#9aa6b2"
          value={publisher}
          onChangeText={setPublisher}
        />

        <TextInput
          style={styles.input}
          placeholder="Format (e.g., Hardcover, Paperback)"
          placeholderTextColor="#9aa6b2"
          value={format}
          onChangeText={setFormat}
        />

        <TextInput
          style={styles.input}
          placeholder="Year"
          placeholderTextColor="#9aa6b2"
          value={year}
          onChangeText={setYear}
          keyboardType="numeric"
        />

        <TextInput
          style={styles.input}
          placeholder="Tags (comma-separated)"
          placeholderTextColor="#9aa6b2"
          value={tags}
          onChangeText={setTags}
        />

        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={saveChanges}
          disabled={saving}
        >
          <Text style={styles.buttonText}>
            {saving ? "Saving..." : "Save Changes"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f14" },
  content: { padding: 16, paddingBottom: 24 },
  header: {
    fontSize: 20,
    fontWeight: "700",
    color: "#e6edf3",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#0b1320",
    color: "#e6edf3",
    borderColor: "#223043",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  button: {
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryButton: { backgroundColor: "#5a8efc" },
  buttonText: { color: "#0b0f14", fontWeight: "700" },
  error: { color: "#ff9aa3", marginBottom: 12 },
});
