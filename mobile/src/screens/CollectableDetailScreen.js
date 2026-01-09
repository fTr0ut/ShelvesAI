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
  TouchableOpacity,
  View,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { apiRequest } from "../services/api";
import { colors, spacing, typography } from "../theme";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";

const EDITABLE_FIELDS = [
  {
    key: "title",
    label: "Title",
    placeholder: "Enter title",
    autoCapitalize: "words",
  },
  {
    key: "primaryCreator",
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

  // Editing state
  const [editingField, setEditingField] = useState(null);
  const [savingField, setSavingField] = useState(null);
  const [draftValues, setDraftValues] = useState({});

  const getFieldValue = useCallback(
    (fieldKey) => {
      if (!collectable) return "";
      const raw = collectable[fieldKey];
      if (fieldKey === "tags") {
        if (Array.isArray(raw)) {
          return raw
            .map((tag) =>
              typeof tag === "string" ? tag.trim() : String(tag || "").trim()
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
    [collectable]
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
    if (collectable) {
      navigation.setOptions({
        headerTitle: collectable.name || collectable.title || title || "Item Details",
      });
    }
  }, [collectable, navigation, title]);

  const startEditing = useCallback(
    (fieldKey) => {
      setEditingField(fieldKey);
      setError("");
      setDraftValues((prev) => ({
        ...prev,
        [fieldKey]: getFieldValue(fieldKey),
      }));
    },
    [getFieldValue]
  );

  const cancelEditing = useCallback(
    (fieldKey) => {
      setEditingField(null);
      setSavingField(null);
      // Reset draft for this field
      setDraftValues((prev) => ({
        ...prev,
        [fieldKey]: getFieldValue(fieldKey),
      }));
    },
    [getFieldValue]
  );

  const saveField = useCallback(
    async (fieldKey) => {
      if (!collectable) return;
      const draftValue = draftValues[fieldKey] ?? "";
      const trimmedValue =
        typeof draftValue === "string" ? draftValue.trim() : draftValue;

      if ((fieldKey === "name" || fieldKey === "title") && !trimmedValue) {
        setError("Title cannot be empty.");
        return;
      }

      try {
        setSavingField(fieldKey);
        setError("");

        // Map 'title' back to 'name' if the API expects 'name' but the UI uses 'title'? 
        // The original code used `collectable.name || title`.
        // Let's assume the API field is what's in key. 
        // Actually, original `EDITABLE_FIELDS` had `key: "title"`. 
        // But `collectable` object uses `name` often in schemas using `title`.
        // Let's check `collectable` structure from `rows`.

        // If the key is 'title' but backend uses 'name', we might need mapping.
        // Assuming the keys in `EDITABLE_FIELDS` match the backend for now.

        let payloadKey = fieldKey;
        if (fieldKey === 'title' && collectable.name !== undefined && collectable.title === undefined) {
          // Heuristic: if object has name but not title, maybe we should update name
          payloadKey = 'name';
        }

        const body = { [payloadKey]: trimmedValue };

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
    [apiBase, collectable, draftValues, id, token]
  );

  const handleDelete = async () => {
    Alert.alert(
      "Delete Item",
      "Are you sure you want to delete this item? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await apiRequest({
                apiBase,
                path: `/api/collectables/${id}`,
                method: "DELETE",
                token,
              });
              navigation.goBack();
            } catch (e) {
              setError(e.message);
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const renderField = (field) => {
    const isEditing = editingField === field.key;
    const isSaving = savingField === field.key;
    const value = isEditing ? (draftValues[field.key] ?? "") : getFieldValue(field.key);

    return (
      <View key={field.key} style={styles.fieldContainer}>
        <View style={styles.fieldHeader}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          {!isEditing && (
            <TouchableOpacity onPress={() => startEditing(field.key)}>
              <Ionicons name="pencil" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {isEditing ? (
          <View style={styles.editContainer}>
            <Input
              value={value}
              onChangeText={(text) =>
                setDraftValues((prev) => ({ ...prev, [field.key]: text }))
              }
              placeholder={field.placeholder}
              autoCapitalize={field.autoCapitalize}
              keyboardType={field.keyboardType}
              containerStyle={{ marginBottom: 8 }}
            />
            <View style={styles.editActions}>
              <Button
                variant="ghost"
                size="sm"
                onPress={() => cancelEditing(field.key)}
                disabled={isSaving}
                title="Cancel"
              />
              <Button
                variant="primary"
                size="sm"
                onPress={() => saveField(field.key)}
                loading={isSaving}
                title="Save"
              />
            </View>
          </View>
        ) : (
          <Text style={styles.fieldValue}>{value || "—"}</Text>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!collectable) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Item not found.</Text>
        <Button title="Go Back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Hero Section */}
          <View style={styles.heroSection}>
            <View style={styles.iconPlaceholder}>
              <Ionicons name="cube-outline" size={40} color={colors.primary} />
            </View>
            <View style={styles.heroContent}>
              <Text style={styles.heroTitle}>
                {collectable.name || collectable.title || "Untitled Item"}
              </Text>
              <Badge variant="secondary" label={collectable.type || "Item"} />
            </View>
          </View>

          {/* Details Card */}
          <Card style={styles.detailsCard}>
            {EDITABLE_FIELDS.map(renderField)}

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Description</Text>
              <Text style={styles.fieldValue}>{collectable.description || "—"}</Text>
            </View>
          </Card>

          {/* Danger Zone */}
          <View style={styles.dangerZone}>
            <Button
              variant="danger"
              title="Delete Item"
              icon="trash-2"
              onPress={handleDelete}
            />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 40,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.md,
    gap: 8,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    fontFamily: typography.medium,
  },
  heroSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  iconPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroContent: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontFamily: typography.bold,
  },
  detailsCard: {
    marginBottom: spacing.lg,
  },
  fieldContainer: {
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: {
    color: colors.textPrimary,
    fontSize: 16,
    fontFamily: typography.regular,
    lineHeight: 24,
  },
  editContainer: {
    marginTop: 4,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dangerZone: {
    marginTop: spacing.sm,
  }
});
