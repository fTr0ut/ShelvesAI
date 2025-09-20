import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import FooterNav from "../components/FooterNav";

import { AuthContext } from "../App";

import { apiRequest } from "../services/api";

const EDITABLE_FIELDS = [
  {
    key: "name",
    label: "Title",
    placeholder: "Enter title",
    autoCapitalize: "words",
  },

  {
    key: "author",
    label: "Author / Creator",
    placeholder: "Enter author",
    autoCapitalize: "words",
  },

  {
    key: "publisher",
    label: "Publisher",
    placeholder: "Enter publisher",
    autoCapitalize: "words",
  },

  {
    key: "format",
    label: "Format",
    placeholder: "Enter format",
    autoCapitalize: "words",
  },

  {
    key: "position",
    label: "Position",
    placeholder: "Enter position (e.g., top shelf, far left)",
    autoCapitalize: "sentences",
  },

  {
    key: "tags",
    label: "Tags",
    placeholder: "Enter tags separated by commas",
    autoCapitalize: "none",
  },

  {
    key: "year",
    label: "Year",
    placeholder: "Enter year",
    keyboardType: "numeric",
  },
];

export default function CollectableDetailScreen({ route, navigation }) {
  const { id, title } = route.params;

  const { token, apiBase } = useContext(AuthContext);

  const [collectable, setCollectable] = useState(null);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(true);

  const [editingField, setEditingField] = useState(null);

  const [savingField, setSavingField] = useState(null);

  const [draftValues, setDraftValues] = useState({
    name: "",
    author: "",
    publisher: "",
    format: "",
    position: "",
    tags: "",
    year: "",
  });

  const getFieldValue = useCallback(
    (fieldKey) => {
      if (!collectable) return "";
      const raw = collectable[fieldKey];
      if (fieldKey === "tags") {
        if (Array.isArray(raw)) {
          return raw
            .map((tag) =>
              typeof tag === "string" ? tag.trim() : String(tag || "").trim(),
            )
            .filter(Boolean)
            .join(", ");
        }
        if (typeof raw === "string") {
          return raw;
        }
        return "";
      }
      return raw || "";
    },
    [collectable],
  );

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest({
          apiBase,
          path: `/api/collectables/${id}`,
          token,
        });

        setCollectable(data.collectable);

        setError("");
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [apiBase, id, token]);

  useEffect(() => {
    if (!collectable) return;

    setDraftValues({
      name: getFieldValue("name"),
      author: getFieldValue("author"),
      publisher: getFieldValue("publisher"),
      format: getFieldValue("format"),
      position: getFieldValue("position"),
      tags: getFieldValue("tags"),
      year: getFieldValue("year"),
    });

    navigation.setOptions({
      title: collectable.name || title || "Collectable",
    });
  }, [collectable, navigation, title, getFieldValue]);

  const startEditing = useCallback(
    (fieldKey) => {
      setEditingField(fieldKey);
      setError("");
      setDraftValues((prev) => ({
        ...prev,
        [fieldKey]: getFieldValue(fieldKey),
      }));
    },
    [getFieldValue],
  );

  const cancelEditing = useCallback(
    (fieldKey) => {
      setEditingField(null);
      setSavingField(null);
      setDraftValues((prev) => ({
        ...prev,
        [fieldKey]: getFieldValue(fieldKey),
      }));
    },
    [getFieldValue],
  );

  const saveField = useCallback(
    async (fieldKey) => {
      if (!collectable) return;

      const draftValue = draftValues[fieldKey] ?? "";

      const trimmedValue =
        typeof draftValue === "string" ? draftValue.trim() : draftValue;

      if (fieldKey === "name" && !trimmedValue) {
        setError("Title cannot be empty.");

        return;
      }

      try {
        setSavingField(fieldKey);

        setError("");

        const body = { [fieldKey]: trimmedValue };

        const data = await apiRequest({
          apiBase,

          path: `/api/collectables/${id}`,

          method: "PUT",

          token,

          body,
        });

        setCollectable(data.collectable);

        setEditingField(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setSavingField(null);
      }
    },

    [apiBase, collectable, draftValues, id, token],
  );

  const rows = useMemo(() => {
    if (!collectable) return [];

    const baseRows = [
      ...EDITABLE_FIELDS.map((field) => ({
        ...field,
        value: getFieldValue(field.key),
        editable: true,
      })),

      { key: "type", label: "Type", value: collectable.type, editable: false },

      {
        key: "description",
        label: "Description",
        value: collectable.description,
        editable: false,
      },
    ];

    return baseRows.filter((row) => row.editable || row.value);
  }, [collectable]);

  let body;

  if (loading) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color="#5a8efc" size="large" />

        <Text style={styles.muted}>Loading collectable.</Text>
      </View>
    );
  } else if (error && !collectable) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  } else if (!collectable) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.error}>Collectable not found</Text>
      </View>
    );
  } else {
    body = (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>{collectable.name || title}</Text>

        {error ? <Text style={styles.errorInline}>{error}</Text> : null}

        <View style={styles.card}>
          {rows.length ? (
            rows.map((row) => {
              const isEditing = editingField === row.key;

              const isSaving = savingField === row.key;

              const value = isEditing
                ? (draftValues[row.key] ?? "")
                : row.value;

              return (
                <View key={row.key} style={styles.row}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.label}>{row.label}</Text>

                    {row.editable ? (
                      isEditing ? (
                        <TouchableOpacity
                          style={styles.editTrigger}
                          onPress={() => cancelEditing(row.key)}
                          disabled={isSaving}
                        >
                          <Text style={styles.editTriggerText}>Cancel</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.editTrigger}
                          onPress={() => startEditing(row.key)}
                        >
                          <Text style={styles.editTriggerText}>Edit</Text>
                        </TouchableOpacity>
                      )
                    ) : null}
                  </View>

                  {row.editable && isEditing ? (
                    <View style={styles.editArea}>
                      <TextInput
                        style={styles.input}
                        value={value}
                        onChangeText={(text) =>
                          setDraftValues((prev) => ({
                            ...prev,

                            [row.key]: text,
                          }))
                        }
                        placeholder={row.placeholder}
                        placeholderTextColor="#55657a"
                        autoCapitalize={row.autoCapitalize || "sentences"}
                        keyboardType={row.keyboardType || "default"}
                        editable={!isSaving}
                      />

                      <View style={styles.editActions}>
                        <TouchableOpacity
                          style={[styles.smallButton, styles.saveButton]}
                          onPress={() => saveField(row.key)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <ActivityIndicator color="#0b0f14" size="small" />
                          ) : (
                            <Text style={styles.smallButtonText}>Save</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.value}>{value || "--"}</Text>
                  )}
                </View>
              );
            })
          ) : (
            <Text style={styles.muted}>No additional metadata available.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      {body}

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0f14" },

  container: { flex: 1, backgroundColor: "#0b0f14" },

  content: { padding: 16, paddingBottom: 40, gap: 16 },

  centered: {
    flex: 1,
    backgroundColor: "#0b0f14",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  title: { fontSize: 24, fontWeight: "700", color: "#e6edf3" },

  card: {
    backgroundColor: "#0e1522",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#223043",
    padding: 16,
    gap: 18,
  },

  row: { gap: 6 },

  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  label: {
    color: "#9aa6b2",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  editTrigger: { paddingHorizontal: 6, paddingVertical: 2 },

  editTriggerText: { color: "#7ca6ff", fontSize: 12 },

  value: { color: "#e6edf3", fontSize: 16 },

  error: { color: "#ff9aa3", fontSize: 16 },

  errorInline: { color: "#ff9aa3" },

  muted: { color: "#9aa6b2" },

  editArea: { gap: 8 },

  input: {
    backgroundColor: "#0b1320",

    color: "#e6edf3",

    borderColor: "#223043",

    borderWidth: 1,

    borderRadius: 10,

    paddingHorizontal: 12,

    paddingVertical: 10,
  },

  editActions: { flexDirection: "row", justifyContent: "flex-end" },

  smallButton: {
    paddingHorizontal: 12,

    paddingVertical: 8,

    borderRadius: 8,

    backgroundColor: "#5a8efc",
  },

  saveButton: {},

  smallButtonText: { color: "#0b0f14", fontWeight: "600" },
});
