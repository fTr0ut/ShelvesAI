import React, { useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import FooterNav from "../components/FooterNav"
import { AuthContext } from "../App"
import { apiRequest } from "../services/api"

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "friends", label: "Friends" },
  { value: "public", label: "Public" },
]

export default function ShelfEditScreen({ navigation, route }) {
  const { token, apiBase } = useContext(AuthContext)
  const shelfId = route.params?.shelfId ?? route.params?.id ?? null
  const initialName = route.params?.initialName ?? ""
  const initialVisibility = route.params?.initialVisibility ?? "private"

  const [name, setName] = useState(initialName)
  const [visibility, setVisibility] = useState(initialVisibility)
  const [loading, setLoading] = useState(!initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    navigation.setOptions({ title: initialName ? `Edit ${initialName}` : "Edit Shelf" })
  }, [navigation, initialName])

  useEffect(() => {
    if (!shelfId) {
      setError("Shelf not found.")
      setLoading(false)
      return
    }

    let isMounted = true

    const fetchShelf = async () => {
      try {
        setError("")
        if (!initialName) setLoading(true)
        const data = await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}`,
          token,
        })
        if (!isMounted) return
        const fetchedShelf = data?.shelf ?? {}
        setName(fetchedShelf.name ?? "")
        setVisibility(fetchedShelf.visibility ?? "private")
        navigation.setOptions({
          title: fetchedShelf.name ? `Edit ${fetchedShelf.name}` : "Edit Shelf",
        })
      } catch (e) {
        if (isMounted) setError(e.message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchShelf()

    return () => {
      isMounted = false
    }
  }, [apiBase, token, shelfId, navigation, initialName])

  const visibilityLabel = useMemo(() => {
    const match = VISIBILITY_OPTIONS.find((opt) => opt.value === visibility)
    return match?.label ?? ""
  }, [visibility])

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim()
    if (!shelfId) {
      setError("Shelf not found.")
      return
    }
    if (!trimmedName) {
      setError("Please enter a shelf name.")
      return
    }

    try {
      setSaving(true)
      setError("")
      await apiRequest({
        apiBase,
        path: `/api/shelves/${shelfId}`,
        method: "PUT",
        token,
        body: { name: trimmedName, visibility },
      })
      navigation.goBack()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [apiBase, token, shelfId, name, visibility, navigation])

  const disabled = saving || loading
  const showLoadingIndicator = loading && !initialName

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.section}>Shelf Name</Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => {
              setName(value)
              if (error) setError("")
            }}
            placeholder="Enter shelf name"
            placeholderTextColor="#55657a"
            editable={!disabled}
            autoCapitalize="sentences"
          />

          <Text style={styles.section}>Visibility</Text>

          <View style={styles.chipGroup}>
            {VISIBILITY_OPTIONS.map((opt) => {
              const selected = visibility === opt.value

              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => setVisibility(opt.value)}
                  disabled={disabled}
                >
                  <Text style={styles.chipText}>{opt.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.helper}>
            Currently visible to: {visibilityLabel || "-"}
          </Text>

          {showLoadingIndicator ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#5a8efc" size="small" />
              <Text style={styles.loadingText}>Loading latest shelf data...</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.primaryButton,
              (saving || loading) && styles.buttonDisabled,
            ]}
            onPress={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <ActivityIndicator color="#0b0f14" size="small" />
            ) : (
              <Text style={styles.buttonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0f14" },

  container: { flex: 1, backgroundColor: "#0b0f14" },

  content: { padding: 16, paddingBottom: 40, gap: 16 },

  card: {
    backgroundColor: "#0e1522",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#223043",
    padding: 16,
    gap: 12,
  },

  section: {
    color: "#9aa6b2",
    fontWeight: "500",
    textTransform: "uppercase",
    fontSize: 12,
  },

  input: {
    backgroundColor: "#0b1320",
    color: "#e6edf3",
    borderColor: "#223043",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  chipGroup: { flexDirection: "row", gap: 8 },

  chip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#223043",
    backgroundColor: "#0b1320",
  },

  chipActive: { backgroundColor: "#15223a", borderColor: "#5a8efc" },

  chipText: { color: "#e6edf3", fontSize: 12, fontWeight: "600" },

  helper: { color: "#55657a", fontSize: 12 },

  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  loadingText: { color: "#9aa6b2", fontSize: 12 },

  actions: { gap: 12 },

  button: {
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: "#0b1320",
    borderWidth: 1,
    borderColor: "#223043",
  },

  primaryButton: { backgroundColor: "#5a8efc", borderColor: "#5a8efc" },

  buttonDisabled: { opacity: 0.6 },

  buttonText: { color: "#0b0f14", fontWeight: "700" },

  error: { color: "#ff9aa3", marginBottom: 12 },
})
