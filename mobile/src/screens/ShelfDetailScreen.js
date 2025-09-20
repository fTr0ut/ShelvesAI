import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";

import * as ImagePicker from "expo-image-picker";

import FooterNav from "../components/FooterNav";

import { AuthContext } from "../App";

import { apiRequest } from "../services/api";

const ITEM_SORT_OPTIONS = [
  { value: "alpha-asc", label: "A to Z" },

  { value: "alpha-desc", label: "Z to A" },

  { value: "position", label: "Position" },

  { value: "created-desc", label: "Date Created" },
];

export default function ShelfDetailScreen({ route, navigation }) {
  const { id } = route.params;

  const { token, apiBase } = useContext(AuthContext);

  const [shelf, setShelf] = useState(null);

  const [items, setItems] = useState([]);

  const [itemSortMode, setItemSortMode] = useState("alpha-asc");

  const [error, setError] = useState("");

  const [manual, setManual] = useState({ name: "", type: "", description: "" });

  const [q, setQ] = useState("");

  const [results, setResults] = useState([]);

  const [visionLoading, setVisionLoading] = useState(false);

  const [visionMessage, setVisionMessage] = useState("");

  const [analysis, setAnalysis] = useState(null);

  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        apiRequest({ apiBase, path: `/api/shelves/${id}`, token }),

        apiRequest({ apiBase, path: `/api/shelves/${id}/items`, token }),
      ]);

      setShelf(s.shelf);

      setItems(i.items);

      navigation.setOptions({ title: s.shelf.name });

      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [apiBase, id, token, navigation]);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        hasLoadedRef.current = true;
      }
    })();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedRef.current) {
        load();
      }
    }, [load]),
  );

  const sortedItems = useMemo(() => {
    const list = Array.isArray(items) ? [...items] : [];

    const getTitle = (entry) => {
      const collectable = entry?.collectable || null;

      const manual = entry?.manual || null;

      return collectable?.name || manual?.name || "Untitled item";
    };

    const compareName = (a, b) => getTitle(a).localeCompare(getTitle(b));

    const compareCreated = (a, b) => {
      const timeA = new Date(a?.createdAt || 0).getTime() || 0;

      const timeB = new Date(b?.createdAt || 0).getTime() || 0;

      return timeB - timeA;
    };

    const extractPositionInfo = (entry) => {
      const collectable = entry?.collectable || null;

      const manual = entry?.manual || null;

      const raw =
        collectable?.position ??
        manual?.position ??
        collectable?.location ??
        manual?.location ??
        null;

      const base = {
        row: Number.POSITIVE_INFINITY,

        col: Number.POSITIVE_INFINITY,

        label: "",
      };

      if (!raw) return base;

      if (Array.isArray(raw)) {
        return {
          row: Number.POSITIVE_INFINITY,

          col: Number.POSITIVE_INFINITY,

          label: raw.filter(Boolean).join(", "),
        };
      }

      if (typeof raw === "object" && raw) {
        const rawX = raw.x ?? raw.col ?? raw.column ?? raw.longitude ?? raw.lon;

        const rawY = raw.y ?? raw.row ?? raw.latitude ?? raw.lat;

        const parsedRow = Number(rawY);

        const parsedCol = Number(rawX);

        let label = "";

        if (typeof raw.label === "string" && raw.label.trim()) {
          label = raw.label.trim();
        } else if (
          typeof raw.description === "string" &&
          raw.description.trim()
        ) {
          label = raw.description.trim();
        } else {
          const hasRow =
            rawY !== undefined && rawY !== null && `${rawY}`.trim() !== "";

          const hasCol =
            rawX !== undefined && rawX !== null && `${rawX}`.trim() !== "";

          if (hasRow || hasCol) {
            const displayCol = hasCol ? rawX : "?";

            const displayRow = hasRow ? rawY : "?";

            label = `(${displayCol}, ${displayRow})`;
          }
        }

        return {
          row: Number.isFinite(parsedRow)
            ? parsedRow
            : Number.POSITIVE_INFINITY,

          col: Number.isFinite(parsedCol)
            ? parsedCol
            : Number.POSITIVE_INFINITY,

          label,
        };
      }

      return {
        row: Number.POSITIVE_INFINITY,

        col: Number.POSITIVE_INFINITY,

        label: String(raw).trim(),
      };
    };

    const comparePosition = (a, b) => {
      const pa = extractPositionInfo(a);

      const pb = extractPositionInfo(b);

      const rowFiniteA = Number.isFinite(pa.row);

      const rowFiniteB = Number.isFinite(pb.row);

      if (rowFiniteA && rowFiniteB && pa.row !== pb.row) {
        return pa.row - pb.row;
      }

      if (rowFiniteA !== rowFiniteB) {
        return rowFiniteA ? -1 : 1;
      }

      const colFiniteA = Number.isFinite(pa.col);

      const colFiniteB = Number.isFinite(pb.col);

      if (colFiniteA && colFiniteB && pa.col !== pb.col) {
        return pa.col - pb.col;
      }

      if (colFiniteA !== colFiniteB) {
        return colFiniteA ? -1 : 1;
      }

      const labelA = (pa.label || "").toLowerCase();

      const labelB = (pb.label || "").toLowerCase();

      if (labelA && labelB && labelA !== labelB) {
        return labelA.localeCompare(labelB);
      }

      if (labelA && !labelB) return -1;

      if (!labelA && labelB) return 1;

      return compareName(a, b);
    };

    switch (itemSortMode) {
      case "alpha-desc":
        return list.sort((a, b) => compareName(b, a));

      case "created-desc":
        return list.sort(compareCreated);

      case "position":
        return list.sort(comparePosition);

      case "alpha-asc":

      default:
        return list.sort(compareName);
    }
  }, [items, itemSortMode]);

  const refreshItems = async () => {
    try {
      const data = await apiRequest({
        apiBase,

        path: `/api/shelves/${id}/items`,

        token,
      });

      setItems(data.items);
    } catch (e) {
      setError(e.message);
    }
  };

  const openShelfEdit = useCallback(() => {
    if (!shelf) return;

    navigation.navigate("ShelfEdit", {
      shelfId: id,

      initialName: shelf.name,

      initialVisibility: shelf.visibility,

      initialType: shelf.type,
    });
  }, [shelf, navigation, id]);

  const addManual = async () => {
    setError("");

    try {
      await apiRequest({
        apiBase,

        path: `/api/shelves/${id}/manual`,

        method: "POST",

        token,

        body: manual,
      });

      setManual({ name: "", type: "", description: "" });

      await refreshItems();
    } catch (e) {
      setError(e.message);
    }
  };

  const search = async (term) => {
    const next = (term ?? q).trim();

    if (!next) {
      setResults([]);

      return;
    }

    try {
      const data = await apiRequest({
        apiBase,

        path: `/api/shelves/${id}/search?q=${encodeURIComponent(next)}`,

        token,
      });

      setResults(data.results);
    } catch (e) {
      setError(e.message);
    }
  };

  const addCollectable = async (collectableId) => {
    setError("");

    try {
      await apiRequest({
        apiBase,

        path: `/api/shelves/${id}/items`,

        method: "POST",

        token,

        body: { collectableId },
      });

      setResults([]);

      await refreshItems();
    } catch (e) {
      setError(e.message);
    }
  };

  const removeItem = async (itemId) => {
    setError("");

    try {
      const data = await apiRequest({
        apiBase,

        path: `/api/shelves/${id}/items/${itemId}`,

        method: "DELETE",

        token,
      });

      setItems(data.items || []);

      setVisionMessage("");
    } catch (e) {
      setError(e.message);
    }
  };

  const confirmRemove = (itemId, name) => {
    Alert.alert("Remove item", `Remove "${name}" from this shelf?`, [
      { text: "Cancel", style: "cancel" },

      {
        text: "Remove",

        style: "destructive",

        onPress: () => removeItem(itemId),
      },
    ]);
  };

  const openCollectable = (collectable) => {
    const collectableId = collectable?._id || collectable?.id;

    if (!collectableId) return;

    navigation.navigate("CollectableDetail", {
      id: collectableId,

      title: collectable.name,
    });
  };

  const captureShelf = async () => {
    setError("");

    setVisionMessage("");

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        setError("Camera permission denied");

        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        base64: true,

        quality: 0.5,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];

      if (!asset?.base64) {
        setError("Failed to capture image");

        return;
      }

      setVisionLoading(true);

      const data = await apiRequest({
        apiBase,

        path: `/api/shelves/${id}/vision`,

        method: "POST",

        token,

        body: {
          imageBase64: `data:${asset.type || "image/jpeg"};base64,${asset.base64}`,
        },
      });

      setAnalysis(data.analysis);

      setVisionMessage(
        `Detected ${data.analysis?.items?.length || 0} items. Added ${data.addedCount || 0}.`,
      );

      await refreshItems();
    } catch (e) {
      setError(e.message);
    } finally {
      setVisionLoading(false);
    }
  };

  const visibilityLabel = shelf?.visibility
    ? `${shelf.visibility.charAt(0).toUpperCase()}${shelf.visibility.slice(1)}`
    : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <View style={styles.shelfHeader}>
            <Text style={styles.title}>{shelf?.name || "Shelf"}</Text>

            <TouchableOpacity
              style={[styles.editButton, !shelf && styles.editButtonDisabled]}
              onPress={openShelfEdit}
              disabled={!shelf}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Items</Text>

          <View
            style={[
              styles.itemSortRow,

              !items.length && styles.itemSortRowDisabled,
            ]}
          >
            {ITEM_SORT_OPTIONS.map((opt) => {
              const selected = itemSortMode === opt.value;

              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.itemSortChip,

                    selected && styles.itemSortChipActive,

                    !items.length && styles.itemSortChipDisabled,
                  ]}
                  onPress={() => {
                    if (items.length) setItemSortMode(opt.value);
                  }}
                  disabled={!items.length}
                >
                  <Text
                    style={[
                      styles.itemSortChipText,

                      selected && styles.itemSortChipTextActive,

                      !items.length && styles.itemSortChipTextDisabled,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {items.length ? (
            <View style={styles.itemGrid}>
              {sortedItems.map((it) => {
                const isCollectable = Boolean(it.collectable);

                const collectable = it.collectable || null;

                const manualItem = it.manual || null;

                const title =
                  collectable?.name || manualItem?.name || "Untitled item";

                const detailParts = isCollectable
                  ? [
                      collectable?.author,

                      collectable?.format,

                      collectable?.publisher,

                      collectable?.year,
                    ]
                  : [manualItem?.type, manualItem?.description];

                const detail = detailParts.filter(Boolean).join(" | ");

                const rawPosition =
                  collectable?.position ||
                  manualItem?.position ||
                  collectable?.location ||
                  manualItem?.location ||
                  null;

                let positionLabel = null;

                if (rawPosition) {
                  if (Array.isArray(rawPosition)) {
                    positionLabel = rawPosition.filter(Boolean).join(", ");
                  } else if (typeof rawPosition === "object") {
                    const posX =
                      rawPosition.x ?? rawPosition.col ?? rawPosition.column;

                    const posY = rawPosition.y ?? rawPosition.row;

                    const hasX =
                      posX !== undefined &&
                      posX !== null &&
                      `${posX}`.trim() !== "";

                    const hasY =
                      posY !== undefined &&
                      posY !== null &&
                      `${posY}`.trim() !== "";

                    if (hasX || hasY) {
                      const displayX = hasX ? posX : "?";

                      const displayY = hasY ? posY : "?";

                      positionLabel = `(${displayX}, ${displayY})`;
                    }
                  } else {
                    positionLabel = String(rawPosition);
                  }
                }

                const typeLabel = isCollectable
                  ? collectable?.type || shelf?.type || "Collectable"
                  : manualItem?.type || shelf?.type || "Manual";

                return (
                  <View key={it.id} style={styles.itemTile}>
                    <TouchableOpacity
                      style={styles.itemTileBody}
                      activeOpacity={isCollectable ? 0.75 : 1}
                      onPress={() =>
                        isCollectable && openCollectable(collectable)
                      }
                    >
                      <View style={styles.itemTileHeader}>
                        <Text style={styles.itemTileType}>{typeLabel}</Text>

                        {positionLabel ? (
                          <Text style={styles.itemTilePosition}>
                            {positionLabel}
                          </Text>
                        ) : null}
                      </View>

                      <Text style={styles.itemTileTitle} numberOfLines={2}>
                        {title}
                      </Text>

                      {detail ? (
                        <Text style={styles.itemTileMeta} numberOfLines={3}>
                          {detail}
                        </Text>
                      ) : null}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.itemTileRemove}
                      onPress={() => confirmRemove(it.id, title)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.itemTileRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.muted}>No items yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Camera and Vision AI</Text>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={captureShelf}
            disabled={visionLoading}
          >
            <Text style={styles.buttonText}>
              {visionLoading ? "Analyzing photo..." : "Capture shelf photo"}
            </Text>
          </TouchableOpacity>

          {!!visionMessage && (
            <Text style={styles.success}>{visionMessage}</Text>
          )}

          {analysis?.items?.length ? (
            <View style={styles.analysisBox}>
              <Text style={styles.sectionSmall}>Most recent detection</Text>

              {analysis.items.slice(0, 6).map((item, idx) => (
                <Text key={`${item.name}-${idx}`} style={styles.analysisText}>
                  - {item.name}
                  {item.author ? ` by ${item.author}` : ""}
                  {item.format ? ` [${item.format}]` : ""}
                  {typeof item.confidence === "number"
                    ? ` (${Math.round(item.confidence * 100)}%)`
                    : ""}
                </Text>
              ))}

              {analysis.items.length > 6 ? (
                <Text style={styles.muted}>
                  + {analysis.items.length - 6} more detected
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.helper}>
            Photos stay on device until you confirm a capture. Only the selected
            image is sent securely for recognition.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Manually add entry</Text>

          <TextInput
            style={styles.input}
            placeholder="Name"
            placeholderTextColor="#9aa6b2"
            value={manual.name}
            onChangeText={(value) => setManual({ ...manual, name: value })}
          />

          <TextInput
            style={styles.input}
            placeholder="Type"
            placeholderTextColor="#9aa6b2"
            value={manual.type}
            onChangeText={(value) => setManual({ ...manual, type: value })}
          />

          <TextInput
            style={styles.input}
            placeholder="Description"
            placeholderTextColor="#9aa6b2"
            value={manual.description}
            onChangeText={(value) =>
              setManual({ ...manual, description: value })
            }
          />

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={addManual}
          >
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>

          <Text style={[styles.section, { marginTop: 12 }]}>
            Search catalog
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Search by title"
            placeholderTextColor="#9aa6b2"
            value={q}
            onChangeText={(value) => {
              setQ(value);

              if (value.trim().length >= 2) search(value);
              else setResults([]);
            }}
          />

          {results.length ? (
            <View style={styles.searchResults}>
              {results.map((item) => (
                <View key={item._id} style={styles.searchRow}>
                  <Text style={styles.itemMeta} numberOfLines={2}>
                    {item.name}

                    {item.author ? ` by ${item.author}` : ""}

                    {item.format ? ` [${item.format}]` : ""}
                  </Text>

                  <TouchableOpacity
                    style={styles.smallButton}
                    onPress={() => addCollectable(item._id)}
                  >
                    <Text style={styles.smallButtonText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0f14" },

  container: { flex: 1, backgroundColor: "#0b0f14" },

  content: { padding: 16, paddingBottom: 40 },

  card: {
    backgroundColor: "transparent",

    borderRadius: 12,

    borderWidth: 0,

    padding: 16,

    marginBottom: 8,
  },

  title: { fontSize: 22, fontWeight: "700", color: "#e6edf3", marginBottom: 6 },

  shelfHeader: {
    flexDirection: "row",

    justifyContent: "flex-start",

    alignItems: "center",

    gap: 0,

    marginBottom: 2,
  },

  editButton: {
    paddingVertical: 6,

    paddingHorizontal: 12,

    borderRadius: 8,

    borderWidth: 1,

    borderColor: "rgba(0, 0, 0, 0)",

    backgroundColor: "rgba(0, 0, 0, 0)",
  },

  editButtonText: { color: "#9aa6b2", fontSize: 12, fontWeight: "600" },

  editButtonDisabled: { opacity: 0.4 },

  pill: {
    alignSelf: "flex-start",

    color: "#9aa6b2",

    borderWidth: 1,

    borderColor: "#223043",

    borderRadius: 999,

    paddingHorizontal: 10,

    paddingVertical: 2,

    marginBottom: 12,
  },

  section: {
    color: "#9aa6b2",

    fontWeight: "500",

    marginBottom: 8,

    textTransform: "uppercase",

    fontSize: 12,
  },

  sectionSmall: { color: "#9aa6b2", marginBottom: 6, fontSize: 11 },

  itemSortRow: {
    flexDirection: "row",

    flexWrap: "wrap",

    gap: 8,

    marginBottom: 12,
  },

  itemSortRowDisabled: { opacity: 0.6 },

  itemSortChip: {
    paddingVertical: 6,

    paddingHorizontal: 12,

    borderRadius: 999,

    borderWidth: 1,

    borderColor: "#223043",

    backgroundColor: "#0b1320",
  },

  itemSortChipDisabled: { opacity: 0.6 },

  itemSortChipActive: { borderColor: "#5a8efc", backgroundColor: "#15223a" },

  itemSortChipText: { color: "#9aa6b2", fontSize: 12 },

  itemSortChipTextDisabled: { color: "#55657a" },

  itemSortChipTextActive: { color: "#7ca6ff" },

  itemGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },

  itemTile: {
    backgroundColor: "transparent",

    borderRadius: 12,

    borderWidth: 1,

    borderColor: "#223043",

    padding: 12,

    width: "31%",

    minWidth: 160,

    marginBottom: 12,

    flexGrow: 1,
  },

  itemTileBody: { gap: 6 },

  itemTileHeader: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "center",
  },

  itemTileType: { color: "#7ca6ff", fontSize: 12, fontWeight: "600" },

  itemTilePosition: { color: "#55657a", fontSize: 11 },

  itemTileTitle: { color: "#e6edf3", fontSize: 15, fontWeight: "600" },

  itemTileMeta: { color: "#9aa6b2", fontSize: 12 },

  itemTileRemove: {
    marginTop: 10,

    alignSelf: "flex-start",

    paddingVertical: 6,

    paddingHorizontal: 10,

    borderRadius: 8,

    borderWidth: 1,

    borderColor: "#34445d",

    backgroundColor: "#111b2a",
  },

  itemTileRemoveText: { color: "#ff9aa3", fontSize: 12, fontWeight: "600" },

  button: { alignItems: "center", borderRadius: 10, paddingVertical: 12 },

  primaryButton: { backgroundColor: "#5a8efc" },

  buttonText: { color: "#0b0f14", fontWeight: "700" },

  success: { color: "#a5e3bf", marginTop: 8 },

  helper: { color: "#55657a", fontSize: 12, marginTop: 8 },

  analysisBox: {
    marginTop: 10,

    backgroundColor: "#121c2b",

    borderRadius: 10,

    padding: 12,

    borderWidth: 1,

    borderColor: "#1d2b3f",
  },

  analysisText: { color: "#e6edf3", marginBottom: 4, fontSize: 13 },

  input: {
    backgroundColor: "#0b1320",

    color: "#e6edf3",

    borderColor: "#223043",

    borderWidth: 1,

    borderRadius: 10,

    paddingHorizontal: 12,

    paddingVertical: 10,

    marginBottom: 8,
  },

  searchResults: { marginTop: 8 },

  searchRow: {
    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    borderWidth: 1,

    borderColor: "#223043",

    borderRadius: 12,

    padding: 12,

    backgroundColor: "#0e1522",

    marginBottom: 8,
  },

  smallButton: {
    backgroundColor: "#5a8efc",

    paddingVertical: 6,

    paddingHorizontal: 12,

    borderRadius: 8,
  },

  smallButtonText: { color: "#0b0f14", fontWeight: "700" },

  muted: { color: "#9aa6b2" },

  error: { color: "#ff9aa3", marginBottom: 12 },
});
