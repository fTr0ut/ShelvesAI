import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const GRID_DIVISIONS = 10;
const COLLECTABLE_WIDTH = 160;
const COLLECTABLE_HEIGHT = 180;
const COLLECTABLE_PADDING = 18;
const COVER_WIDTH = COLLECTABLE_WIDTH - (COLLECTABLE_PADDING * 2);
const COVER_HEIGHT = COLLECTABLE_HEIGHT - (COLLECTABLE_PADDING * 2 + 26);
const ROW_CLUSTER_TOLERANCE = 0.06;
const SPACING_PAD_PERCENT = 0.2;

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

const clampUnit = (value) => {
  if (!Number.isFinite(value)) return null;
  return clamp(value, 0, 1);
};

const distanceBetweenTouches = (touches) => {
  if (!Array.isArray(touches) || touches.length < 2) return 0;
  const [a, b] = touches;
  const dx = (a?.pageX || 0) - (b?.pageX || 0);
  const dy = (a?.pageY || 0) - (b?.pageY || 0);
  return Math.sqrt(dx * dx + dy * dy);
};

const parseLabelCoordinates = (label) => {
  if (!label || typeof label !== "string") return null;
  const parts = label.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const x = clampUnit(Number(parts[0]));
  const y = clampUnit(Number(parts[1]));
  if (x === null || y === null) return null;
  return { x, y };
};

const extractPosition = (entry) => {
  const userCollection =
    entry?.userCollection || entry?.user_collection || entry?.usercollection || null;

  const userCollectable =
    entry?.userCollectable || entry?.user_collectable || entry?.usercollectable || null;

  const raw =
    userCollection?.position ||
    userCollection?.location ||
    userCollectable?.position ||
    userCollectable?.location ||
    entry?.position ||
    entry?.location ||
    entry?.collectable?.position ||
    entry?.manual?.position ||
    entry?.collectable?.location ||
    entry?.manual?.location ||
    null;

  if (!raw) return null;

  if (Array.isArray(raw)) {
    const [xRaw, yRaw] = raw;
    let x = clampUnit(Number(xRaw));
    let y = clampUnit(Number(yRaw));

    if (x === null || y === null) {
      const fallbackLabel =
        userCollection?.position?.label ||
        userCollectable?.position?.label ||
        null;
      const parsed = parseLabelCoordinates(fallbackLabel);
      if (parsed) {
        x = parsed.x;
        y = parsed.y;
      }
    }

    if (x === null || y === null) return null;
    return { x, y, label: userCollection?.position?.label || userCollectable?.position?.label || null };
  }

  if (typeof raw === "object") {
    const coordinates = (raw.coordinates && typeof raw.coordinates === "object")
      ? raw.coordinates
      : raw.coords && typeof raw.coords === "object"
        ? raw.coords
        : null;

    const xValue =
      raw.x ??
      raw.col ??
      raw.column ??
      raw.longitude ??
      raw.lon ??
      raw.left ??
      raw.horizontal ??
      coordinates?.x ??
      coordinates?.col ??
      coordinates?.column ??
      coordinates?.longitude ??
      coordinates?.lon ??
      coordinates?.left ??
      coordinates?.horizontal;

    const yValue =
      raw.y ??
      raw.row ??
      raw.latitude ??
      raw.lat ??
      raw.top ??
      raw.vertical ??
      coordinates?.y ??
      coordinates?.row ??
      coordinates?.latitude ??
      coordinates?.lat ??
      coordinates?.top ??
      coordinates?.vertical;

    let x = clampUnit(Number(xValue));
    let y = clampUnit(Number(yValue));

    if (x === null || y === null) {
      const fallbackLabel =
        raw.label ||
        userCollection?.position?.label ||
        userCollectable?.position?.label ||
        null;
      const parsed = parseLabelCoordinates(fallbackLabel);
      if (parsed) {
        x = parsed.x;
        y = parsed.y;
      }
    }

    if (x === null || y === null) return null;

    return { x, y, label: raw.label || userCollection?.position?.label || userCollectable?.position?.label || null };
  }

  if (typeof raw === "string") {
    const parsed = parseLabelCoordinates(raw);
    if (parsed) {
      return {
        x: parsed.x,
        y: parsed.y,
        label: userCollection?.position?.label || userCollectable?.position?.label || raw,
      };
    }
  }

  const fallbackLabel = userCollection?.position?.label || userCollectable?.position?.label || null;
  if (fallbackLabel) {
    const parsed = parseLabelCoordinates(fallbackLabel);
    if (parsed) {
      return { x: parsed.x, y: parsed.y, label: fallbackLabel };
    }
  }

  return null;
};

const extractTitle = (entry) => {
  const collectable = entry?.collectable || null;
  const manual = entry?.manual || null;
  const userCollectable =
    entry?.userCollectable || entry?.user_collectable || entry?.usercollectable || null;

  return (
    collectable?.title ||
    collectable?.name ||
    userCollectable?.title ||
    userCollectable?.name ||
    manual?.name ||
    "Untitled item"
  );
};

const resolveCachedCoverPath = (entry) => {
  const collectable = entry?.collectable || null;
  if (!collectable) return null;

  const images = Array.isArray(collectable.images) ? collectable.images : [];
  for (const image of images) {
    const candidate = image?.cachedSmallPath;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const image of images) {
    const url = image?.urlSmall;
    if (typeof url === "string" && url.trim()) {
      return url.trim();
    }
  }

  const fallback = collectable.coverUrl;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  return null;
};

const buildCoverUri = (apiBase, pathOrUrl) => {
  if (!pathOrUrl) return null;
  if (/^https?:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const trimmed = pathOrUrl.replace(/^\/+/, "");
  const resource = trimmed.startsWith("media/") ? trimmed : `media/${trimmed}`;

  if (!apiBase) {
    return `/${resource}`;
  }

  const normalizedBase = apiBase.replace(/\/+$/, "");
  return `${normalizedBase}/${resource}`;
};

const getPlaneDimensions = () => {
  const { width, height } = Dimensions.get("window");
  const baseWidth = Math.max(width, 800);
  const baseHeight = Math.max(height, 600);
  return { width: baseWidth, height: baseHeight };
};

export default function ShelfVisionModal({ visible, onClose, items, apiBase }) {
  const { width: planeWidth, height: planeHeight } = useMemo(getPlaneDimensions, []);

  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastScale = useRef(1);
  const lastTranslate = useRef({ x: 0, y: 0 });
  const pinchDistance = useRef(null);

  useEffect(() => {
    if (!visible) return;
    scale.setValue(1);
    translate.setValue({ x: 0, y: 0 });
    lastScale.current = 1;
    lastTranslate.current = { x: 0, y: 0 };
    pinchDistance.current = null;
  }, [visible, scale, translate]);

  const positionedItems = useMemo(() => {
    if (!Array.isArray(items)) return [];

    const clamp01 = (value) => clamp(value, 0, 1);
    const rows = [];

    const base = items
      .map((entry, index) => {
        const position = extractPosition(entry);
        if (!position) return null;

        const id = entry?.id || entry?._id || `item-${index}`;
        const title = extractTitle(entry);
        const collectable = entry?.collectable || null;
        const manual = entry?.manual || null;
        const detail = collectable?.format || manual?.type || null;
        const coverPath = resolveCachedCoverPath(entry);
        const coverUri = buildCoverUri(apiBase, coverPath);

        return {
          id,
          x: position.x,
          y: position.y,
          title,
          label: position.label,
          detail,
          coverUri,
        };
      })
      .filter(Boolean);

    if (!base.length) return base;

    const median = (values) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };

    const findRow = (value) => rows.find((row) => Math.abs(row.y - value) <= ROW_CLUSTER_TOLERANCE);

    base.forEach((item) => {
      const row = findRow(item.y);
      if (row) {
        row.items.push(item);
        row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
      } else {
        rows.push({ y: item.y, items: [item] });
      }
    });

    rows.forEach((row) => {
      const itemsInRow = row.items;
      const averageY = itemsInRow.reduce((sum, entry) => sum + entry.y, 0) / itemsInRow.length;
      itemsInRow.forEach((entry) => {
        entry.y = averageY;
      });

      if (itemsInRow.length < 2) return;

      const sorted = [...itemsInRow].sort((a, b) => a.x - b.x);
      const diffs = [];
      for (let i = 1; i < sorted.length; i += 1) {
        const diff = sorted[i].x - sorted[i - 1].x;
        if (diff > 0) diffs.push(diff);
      }

      const medianDiff = median(diffs);
      if (!medianDiff) return;

      const extraSpacing = medianDiff * SPACING_PAD_PERCENT;
      const averageShift = extraSpacing * (sorted.length - 1) / 2;
      const provisional = sorted.map((entry, index) => entry.x + extraSpacing * index - averageShift);

      let min = Math.min(...provisional);
      let max = Math.max(...provisional);
      let span = max - min;
      let adjusted = provisional;

      if (span > 1) {
        adjusted = provisional.map((value) => (value - min) / span);
      } else {
        let offset = 0;
        if (min < 0) offset = -min;
        if (max + offset > 1) offset -= (max + offset - 1);
        adjusted = provisional.map((value) => clamp01(value + offset));
      }

      sorted.forEach((entry, index) => {
        entry.x = clamp01(adjusted[index]);
      });
    });

    const maxY = base.reduce((currentMax, entry) => Math.max(currentMax, entry.y), 0);
    const yOffset = maxY < 1 ? 1 - maxY : 0;

    return base.map((entry) => ({
      ...entry,
      x: clamp01(entry.x),
      y: clamp01(entry.y + yOffset),
    }));
  }, [items, apiBase]);

  const zoomTo = (nextScale) => {
    const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    scale.setValue(clamped);
    lastScale.current = clamped;
  };

  const bumpZoom = (factor) => {
    const current = scale.__getValue();
    zoomTo(current * factor);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent?.touches || [];
          if (touches.length >= 2) {
            pinchDistance.current = distanceBetweenTouches(touches);
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          const touches = evt.nativeEvent?.touches || [];
          if (touches.length >= 2) {
            const dist = distanceBetweenTouches(touches);
            if (!pinchDistance.current) {
              pinchDistance.current = dist;
            }
            if (!dist) return;
            const nextScale = clamp(
              lastScale.current * (dist / (pinchDistance.current || dist)),
              MIN_SCALE,
              MAX_SCALE,
            );
            scale.setValue(nextScale);
          } else {
            const nextX = lastTranslate.current.x + gestureState.dx;
            const nextY = lastTranslate.current.y + gestureState.dy;
            translate.setValue({ x: nextX, y: nextY });
          }
        },
        onPanResponderRelease: () => {
          lastTranslate.current = {
            x: translate.x.__getValue(),
            y: translate.y.__getValue(),
          };
          lastScale.current = scale.__getValue();
          pinchDistance.current = null;
        },
        onPanResponderTerminate: () => {
          lastTranslate.current = {
            x: translate.x.__getValue(),
            y: translate.y.__getValue(),
          };
          lastScale.current = scale.__getValue();
          pinchDistance.current = null;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [scale, translate],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle={Platform.OS === "ios" ? "overFullScreen" : "fullScreen"}
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
    >
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <View style={styles.toolbar}>
            <View style={styles.toolbarLeft}>
              <TouchableOpacity
                style={styles.toolbarBack}
                onPress={onClose}
                accessibilityLabel="Back to shelf"
              >
                <Text style={styles.toolbarBackText}>Back</Text>
              </TouchableOpacity>
              <View>
                <Text style={styles.toolbarTitle}>Shelf Vision</Text>
                <Text style={styles.toolbarSubtitle}>
                  {positionedItems.length
                    ? "Pinch to zoom, drag to explore the shelf layout."
                    : "No positional data available for this shelf yet."}
                </Text>
              </View>
            </View>
            <View style={styles.toolbarActions}>
              <TouchableOpacity
                style={[styles.toolbarButton, styles.toolbarButtonSecondary]}
                onPress={() => bumpZoom(1 / 1.2)}
                accessibilityLabel="Zoom out"
              >
                <Text style={styles.toolbarButtonText}>-</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolbarButton, styles.toolbarButtonSecondary]}
                onPress={() => zoomTo(1)}
                accessibilityLabel="Reset zoom"
              >
                <Text style={styles.toolbarButtonText}>1x</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolbarButton, styles.toolbarButtonSecondary]}
                onPress={() => bumpZoom(1.2)}
                accessibilityLabel="Zoom in"
              >
                <Text style={styles.toolbarButtonText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolbarButton, styles.toolbarButtonPrimary]}
                onPress={onClose}
                accessibilityLabel="Close shelf vision"
              >
                <Text style={styles.toolbarButtonCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.canvasContainer}>
            {positionedItems.length ? (
              <View style={styles.canvas} {...panResponder.panHandlers}>
                <Animated.View
                  style={[
                    styles.plane,
                    {
                      width: planeWidth,
                      height: planeHeight,
                      transform: [
                        { translateX: translate.x },
                        { translateY: translate.y },
                        { scale },
                      ],
                    },
                  ]}
                >
                  {Array.from({ length: GRID_DIVISIONS + 1 }).map((_, index) => {
                    const left = (planeWidth / GRID_DIVISIONS) * index;
                    return (
                      <View
                        key={`grid-v-${index}`}
                        pointerEvents="none"
                        style={[styles.gridLineVertical, { left }]}
                      />
                    );
                  })}
                  {Array.from({ length: GRID_DIVISIONS + 1 }).map((_, index) => {
                    const top = (planeHeight / GRID_DIVISIONS) * index;
                    return (
                      <View
                        key={`grid-h-${index}`}
                        pointerEvents="none"
                        style={[styles.gridLineHorizontal, { top }]}
                      />
                    );
                  })}
                  {positionedItems.map((item) => {
                    const x = item.x * planeWidth;
                    const y = item.y * planeHeight;
                    const fallbackInitial = item.title ? String(item.title).trim().charAt(0).toUpperCase() || '?' : '?';
                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.collectable,
                          {
                            left: x - COLLECTABLE_WIDTH / 2,
                            top: y - COLLECTABLE_HEIGHT / 2,
                          },
                        ]}
                      >
                        <View style={styles.collectableCoverWrapper}>
                          {item.coverUri ? (
                            <Image
                              source={{ uri: item.coverUri }}
                              style={styles.collectableCover}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.collectableCoverFallback}>
                              <Text style={styles.collectableCoverFallbackText}>{fallbackInitial}</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.collectableTextBlock}>
                          <Text numberOfLines={1} style={styles.collectableTitle}>
                            {item.title}
                          </Text>
                          {item.detail ? (
                            <Text numberOfLines={1} style={styles.collectableMeta}>
                              {item.detail}
                            </Text>
                          ) : null}
                          {item.label ? (
                            <Text numberOfLines={1} style={styles.collectableLabel}>
                              {item.label}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.collectableMarker} />
                      </View>
                    );
                  })}
                </Animated.View>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  Add position coordinates to items in this shelf to unlock Shelf Vision.
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(7, 11, 20, 0.86)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    flex: 1,
    backgroundColor: "#0b1320",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1c2a3f",
  },
  toolbar: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e2b41",
    backgroundColor: "#0d1525",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  toolbarTitle: {
    color: "#e6edf3",
    fontSize: 20,
    fontWeight: "700",
  },
  toolbarSubtitle: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 4,
    maxWidth: 360,
  },
  toolbarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1,
  },
  toolbarBack: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2d44",
    backgroundColor: "#121b2d",
  },
  toolbarBackText: {
    color: "#9ec1ff",
    fontWeight: "700",
    fontSize: 13,
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  toolbarButton: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  toolbarButtonSecondary: {
    borderColor: "#1f2d44",
    backgroundColor: "#121b2d",
  },
  toolbarButtonPrimary: {
    borderColor: "#4a6ef5",
    backgroundColor: "#5a8efc",
  },
  toolbarButtonText: {
    color: "#9ec1ff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    minWidth: 18,
  },
  toolbarButtonCloseText: {
    color: "#071126",
    fontSize: 14,
    fontWeight: "700",
  },
  canvasContainer: {
    flex: 1,
  },
  canvas: {
    flex: 1,
  },
  plane: {
    alignSelf: "center",
    backgroundColor: "#0f1a2a",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1e2d45",
  },
  gridLineVertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#1f2f47",
  },
  gridLineHorizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1f2f47",
  },
  collectable: {
    position: "absolute",
    width: COLLECTABLE_WIDTH,
    height: COLLECTABLE_HEIGHT,
    backgroundColor: "rgba(90, 142, 252, 0.08)",
    borderWidth: 1,
    borderColor: "#5a8efc",
    borderRadius: 12,
    padding: COLLECTABLE_PADDING,
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 12,
  },
  collectableCoverWrapper: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#13233a",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  collectableCover: {
    width: "100%",
    height: "100%",
  },

  collectableCoverFallback: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1b273d",
  },

  collectableCoverFallbackText: {
    color: "#9db6d8",
    fontSize: 28,
    fontWeight: "700",
  },

  collectableTextBlock: {
    width: COVER_WIDTH,
    alignItems: "center",
    gap: 2,
    marginTop: 8,
  },
  collectableTitle: {
    color: "#e6edf3",
    fontWeight: "700",
    fontSize: 13,
  },
  collectableMeta: {
    color: "#9db6d8",
    fontSize: 11,
    textAlign: "center",
  },
  collectableLabel: {
    color: "#7ca6ff",
    fontSize: 11,
    textAlign: "center",
  },
  collectableMarker: {
    position: "absolute",
    bottom: -8,
    left: "50%",
    transform: [{ translateX: -6 }],
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#5a8efc",
    borderWidth: 2,
    borderColor: "#0f1a2a",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emptyStateText: {
    color: "#94a3b8",
    fontSize: 15,
    textAlign: "center",
  },
});









