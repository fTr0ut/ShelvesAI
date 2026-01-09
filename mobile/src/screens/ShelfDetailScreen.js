import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  FlatList,
  Modal,
  ActivityIndicator,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import FooterNav from "../components/FooterNav";
import ShelfVisionModal from "../components/ShelfVisionModal";
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, radius } from '../theme';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';

const MIME_EXTENSIONS = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const VIDEO_GAME_KEYWORDS = ['video game', 'video games', 'game', 'games'];

async function ensureBase64Image(asset) {
  if (!asset) return null;
  let mime = resolveMimeType(asset);
  let base64 = asset.base64 || null;

  if (!base64 || !SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      base64 = manipulated.base64 || null;
      mime = 'image/jpeg';
    } catch (err) {
      console.warn('[ShelfDetail] image manipulation failed', err);
      base64 = asset.base64 || null;
    }
  }

  if (!base64) return null;

  return { base64, mime };
}

function resolveMimeType(asset) {
  if (!asset) return 'image/jpeg';
  if (asset.mimeType && asset.mimeType.startsWith('image/')) return asset.mimeType;
  if (asset.type && asset.type.startsWith && asset.type.startsWith('image/')) return asset.type;
  if (typeof asset.type === 'string' && asset.type === 'image') return 'image/jpeg';
  if (asset.fileName || asset.filename || asset.uri) {
    const name = asset.fileName || asset.filename || asset.uri || '';
    const match = name.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (match) {
      const ext = match[1].toLowerCase();
      if (MIME_EXTENSIONS[ext]) return MIME_EXTENSIONS[ext];
    }
  }
  return 'image/jpeg';
}

function normalizeShelfType(type) {
  if (!type) return '';
  return String(type).trim().toLowerCase();
}

function isVideoGameShelfType(type) {
  const normalized = normalizeShelfType(type);
  if (!normalized) return false;
  return VIDEO_GAME_KEYWORDS.some((keyword) =>
    normalized === keyword || normalized.includes(keyword)
  );
}

function transformSteamGameToCollectable(game) {
  if (!game) return null;

  const appIdRaw = game.appId ?? game.appid ?? game.id ?? game.appID ?? null;
  const appId = appIdRaw ? String(appIdRaw) : null;
  const title =
    game.title || game.name || game.originalTitle || 'Untitled game';

  const playtime = Number(
    game.playtimeForever ??
    game.playtime_forever ??
    game.playtime ??
    game.totalPlaytimeMinutes ??
    0
  );

  const lastPlayedRaw =
    game.lastPlayedAt ??
    game.lastPlayed ??
    game.rtime_last_played ??
    null;

  const lastPlayedDate = (() => {
    if (!lastPlayedRaw && lastPlayedRaw !== 0) return null;
    if (typeof lastPlayedRaw === 'string') return lastPlayedRaw;
    if (typeof lastPlayedRaw === 'number') {
      if (lastPlayedRaw > 10 ** 12) {
        return new Date(lastPlayedRaw).toISOString();
      }
      return new Date(lastPlayedRaw * 1000).toISOString();
    }
    return null;
  })();

  return {
    _id: appId ? `steam-${appId}` : `steam-${Math.random().toString(36).slice(2)}`,
    kind: 'game',
    type: 'Video Game',
    title,
    primaryCreator: game.primaryCreator || game.developer || null,
    format: 'Digital',
    publisher: game.publisher || null,
    year: game.year ?? game.releaseYear ?? null,
    identifiers: appId
      ? { steam: { appId: [appId] } }
      : {},
    extras: {
      steam: {
        appId: appId || null,
        playtimeForeverMinutes: Number.isFinite(playtime) ? playtime : 0,
        lastPlayedAt: lastPlayedDate,
      },
    },
  };
}


import { AuthContext } from "../App";

import { apiRequest } from "../services/api";
import { AuthContext } from "../App";

import { apiRequest } from "../services/api";
import { ShelfDetailSyncProvider } from "../hooks/useShelfDetailSync";
import { extractTextFromImage, parseTextToItems } from '../services/ocr';


const ITEM_SORT_OPTIONS = [
  { value: "alpha-asc", label: "A to Z" },

  { value: "alpha-desc", label: "Z to A" },

  { value: "author", label: "Author" },

  { value: "rating-desc", label: "User rating" },

  { value: "position", label: "Position" },

  { value: "created-desc", label: "Date Created" },
];

export default function ShelfDetailScreen({ route, navigation }) {
  const { id } = route.params;

  const { token, apiBase, user } = useContext(AuthContext);

  const [shelf, setShelf] = useState(null);

  const [items, setItems] = useState([]);

  const [itemSortMode, setItemSortMode] = useState("alpha-asc");

  const [error, setError] = useState("");

  const [manual, setManual] = useState({ title: "", type: "", description: "" });

  const [q, setQ] = useState("");

  const [results, setResults] = useState([]);

  const [visionLoading, setVisionLoading] = useState(false);

  const [visionMessage, setVisionMessage] = useState("");

  const [visionOpen, setVisionOpen] = useState(false);

  const [analysis, setAnalysis] = useState(null);

  const [visionMetadata, setVisionMetadata] = useState(null);

  const [scanMode, setScanMode] = useState('quick'); // 'quick' | 'cloud'

  // Force quick mode if not premium
  useEffect(() => {
    if (user && !user.isPremium && scanMode === 'cloud') {
      setScanMode('quick');
    }
  }, [user, scanMode]);

  const [ediItem, setEditItem] = useState(null);
  const [needsReviewIds, setNeedsReviewIds] = useState([]);
  const [steamStatus, setSteamStatus] = useState(null);
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamBusy, setSteamBusy] = useState(false);
  const [steamError, setSteamError] = useState("");
  const [steamMessage, setSteamMessage] = useState("");
  const [steamPreview, setSteamPreview] = useState([]);
  const [steamSummary, setSteamSummary] = useState(null);

  const isVideoGameShelf = useMemo(() => {
    const type = shelf?.type || route?.params?.type || "";
    return isVideoGameShelfType(type);
  }, [shelf?.type, route?.params?.type]);

  const openShelfVision = useCallback(() => setVisionOpen(true), []);
  const closeShelfVision = useCallback(() => setVisionOpen(false), []);

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

  useEffect(() => {
    if (!isVideoGameShelf || !token) {
      setSteamStatus(null);
      setSteamPreview([]);
      setSteamSummary(null);
      setSteamMessage("");
      setSteamError("");
      setSteamBusy(false);
      setSteamLoading(false);
      return;
    }

    let cancelled = false;

    setSteamLoading(true);
    setSteamError("");

    (async () => {
      try {
        const data = await apiRequest({ apiBase, path: "/api/steam/status", token });
        if (!cancelled) {
          setSteamStatus(data.steam || null);
          setSteamError("");
        }
      } catch (err) {
        if (!cancelled) {
          setSteamError(err.message);
        }
      } finally {
        if (!cancelled) {
          setSteamLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, token, isVideoGameShelf]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={styles.headerAction}
          onPress={openShelfVision}
          accessibilityLabel="Open Shelf Vision"
        >
          <Text style={styles.headerActionText}>Shelf Vision</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, openShelfVision]);

  const sortedItems = useMemo(() => {
    const list = Array.isArray(items) ? [...items] : [];

    const getUserCollection = (entry) =>
      entry?.userCollection || entry?.user_collection || entry?.usercollection || null;

    const getUserCollectable = (entry) =>
      entry?.userCollectable ||
      entry?.user_collectable ||
      entry?.usercollectable ||
      null;

    const getTitle = (entry) => {
      const collectable = entry?.collectable || null;

      const manual = entry?.manual || null;

      const userCollectable = getUserCollectable(entry);

      return (
        collectable?.title ||
        collectable?.name ||
        userCollectable?.title ||
        userCollectable?.name ||
        manual?.name ||
        "Untitled item"
      );
    };

    const getPrimaryCreator = (entry) => {
      const collectable = entry?.collectable || null;

      const manual = entry?.manual || null;

      const userCollectable = getUserCollectable(entry);

      const candidates = [
        collectable?.primaryCreator,

        collectable?.author,

        userCollectable?.primaryCreator,

        userCollectable?.author,

        manual?.primaryCreator,

        manual?.author,

        manual?.creator,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
      }

      return "";
    };

    const getUserRating = (entry) => {
      const userCollectable = getUserCollectable(entry);

      const candidates = [
        userCollectable?.rating,

        userCollectable?.userRating,

        userCollectable?.ratingValue,

        entry?.rating,

        entry?.userRating,
      ];

      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === "") {
          continue;
        }

        const num = Number(candidate);

        if (Number.isFinite(num)) return num;
      }

      return null;
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

      const userCollection = getUserCollection(entry);

      const raw =
        userCollection?.position ??
        userCollection?.location ??
        entry?.position ??
        entry?.location ??
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

    const compareAuthor = (a, b) => {
      const authorA = getPrimaryCreator(a);

      const authorB = getPrimaryCreator(b);

      if (authorA && authorB && authorA !== authorB) {
        return authorA.localeCompare(authorB);
      }

      if (authorA && !authorB) return -1;

      if (!authorA && authorB) return 1;

      return compareName(a, b);
    };

    const compareRatingDesc = (a, b) => {
      const ratingA = getUserRating(a);

      const ratingB = getUserRating(b);

      const hasA = Number.isFinite(ratingA);

      const hasB = Number.isFinite(ratingB);

      if (hasA && hasB && ratingA !== ratingB) {
        return ratingB - ratingA;
      }

      if (hasA && !hasB) return -1;

      if (!hasA && hasB) return 1;

      return compareName(a, b);
    };

    switch (itemSortMode) {
      case "alpha-desc":
        return list.sort((a, b) => compareName(b, a));

      case "author":
        return list.sort(compareAuthor);

      case "rating-desc":
        return list.sort(compareRatingDesc);

      case "created-desc":
        return list.sort(compareCreated);

      case "position":
        return list.sort(comparePosition);

      case "alpha-asc":

      default:
        return list.sort(compareName);
    }
  }, [items, itemSortMode]);

  const refreshItems = useCallback(async () => {
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
  }, [apiBase, id, token]);

  const handleItemsUpdated = useCallback(async () => {
    setResults([]);
    await refreshItems();
  }, [refreshItems, setResults]);

  const steamPreviewCount = steamPreview.length;

  const previewSteamLibrary = useCallback(async () => {
    if (steamBusy) return;
    if (!token) {
      setSteamError("Authentication required to access Steam.");
      return;
    }
    if (!isVideoGameShelf) return;
    if (!steamStatus?.steamId) {
      setSteamError("Link your Steam account in Account settings to import.");
      return;
    }

    setSteamBusy(true);
    setSteamError("");
    setSteamMessage("");

    try {
      const data = await apiRequest({
        apiBase,
        path: "/api/steam/library/import",
        method: "POST",
        token,
        body: { shelfId: id, dryRun: true },
      });

      const previewRaw = Array.isArray(data?.summary?.preview)
        ? data.summary.preview
        : [];
      const transformed = previewRaw
        .map((game) => transformSteamGameToCollectable(game))
        .filter(Boolean);

      const summaryInfo = data?.summary
        ? {
          ...data.summary,
          totalGames: data?.totalGames ?? null,
          processed: data?.processed ?? transformed.length,
          dryRun: true,
        }
        : null;

      setSteamPreview(transformed);
      setSteamSummary(summaryInfo);

      if (!transformed.length) {
        setSteamMessage("No new Steam games to import right now.");
      } else {
        const total = data?.totalGames ?? transformed.length;
        setSteamMessage(
          `Previewing ${transformed.length} of ${total} games from your Steam library.`
        );
      }
    } catch (err) {
      setSteamError(err.message || "Failed to load Steam preview");
      setSteamPreview([]);
    } finally {
      setSteamBusy(false);
    }
  }, [steamBusy, token, isVideoGameShelf, steamStatus, apiBase, id]);

  const performSteamImport = useCallback(async () => {
    if (steamBusy) return;
    if (!token) {
      setSteamError("Authentication required to import from Steam.");
      return;
    }
    if (!isVideoGameShelf) return;
    if (!steamStatus?.steamId) {
      setSteamError("Link your Steam account in Account settings to import.");
      return;
    }

    setSteamBusy(true);
    setSteamError("");

    try {
      const data = await apiRequest({
        apiBase,
        path: "/api/steam/library/import",
        method: "POST",
        token,
        body: { shelfId: id },
      });

      const summaryInfo = data?.summary
        ? {
          ...data.summary,
          totalGames: data?.totalGames ?? null,
          processed: data?.processed ?? null,
          dryRun: false,
        }
        : null;

      setSteamSummary(summaryInfo);
      setSteamPreview([]);

      const imported = data?.summary?.imported ?? 0;
      const skipped = data?.summary?.skippedExisting ?? 0;

      if (!imported && !skipped) {
        setSteamMessage("No new Steam games were imported.");
      } else {
        const messageParts = [];
        messageParts.push(
          `Imported ${imported} game${imported === 1 ? "" : "s"} from Steam.`
        );
        if (skipped) {
          messageParts.push(
            `Skipped ${skipped} already on this shelf.`
          );
        }
        if (data?.totalGames && imported) {
          messageParts.push(`Library size: ${data.totalGames}.`);
        }
        setSteamMessage(messageParts.join(" "));
      }

      try {
        const statusData = await apiRequest({
          apiBase,
          path: "/api/steam/status",
          token,
        });
        setSteamStatus(statusData.steam || null);
      } catch (_ignored) {
        // silently ignore status refresh errors
      }

      await refreshItems();
    } catch (err) {
      setSteamError(err.message || "Steam import failed");
    } finally {
      setSteamBusy(false);
    }
  }, [steamBusy, token, isVideoGameShelf, steamStatus, apiBase, id, refreshItems]);

  const handleSteamImport = useCallback(() => {
    if (steamBusy) return;
    if (!steamStatus?.steamId) {
      setSteamError("Link your Steam account in Account settings to import.");
      return;
    }

    const message = steamPreviewCount
      ? `Import ${steamPreviewCount} previewed game${steamPreviewCount === 1 ? "" : "s"
      } from Steam?`
      : "Import your Steam library into this shelf? This may take a moment.";

    Alert.alert("Import from Steam", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Import", onPress: () => performSteamImport() },
    ]);
  }, [steamBusy, steamStatus, steamPreviewCount, performSteamImport]);

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

      setManual({ title: "", type: "", description: "" });

      await handleItemsUpdated();
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

  const addCollectable = useCallback(
    async (collectableId) => {
      setError("");

      try {
        await apiRequest({
          apiBase,

          path: `/api/shelves/${id}/items`,

          method: "POST",

          token,

          body: { collectableId },
        });

        await handleItemsUpdated();
      } catch (e) {
        setError(e.message);
      }
    },
    [apiBase, id, token, handleItemsUpdated],
  );

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

  const confirmRemove = (itemId, title) => {
    Alert.alert("Remove item", `Remove "${title}" from this shelf?`, [
      { text: "Cancel", style: "cancel" },

      {
        text: "Remove",

        style: "destructive",

        onPress: () => removeItem(itemId),
      },
    ]);
  };

  const shelfDetailSyncValue = useMemo(
    () => ({ shelfId: id, refreshItems, onItemAdded: handleItemsUpdated }),
    [id, refreshItems, handleItemsUpdated],
  );

  const openCollectable = (collectable) => {
    const collectableId = collectable?._id || collectable?.id;

    if (!collectableId) return;

    navigation.navigate("CollectableDetail", {
      id: collectableId,

      title: collectable.title || collectable.name,
    });
  };

  const handleQuickScan = async (imageUri) => {
    setVisionLoading(true);
    setVisionMessage("Scanning text...");
    try {
      const { text } = await extractTextFromImage(imageUri);

      if (!text || text.length < 5) {
        setVisionMessage("No readable text found.");
        return;
      }

      setVisionMessage("Text detected, analyzing...");
      const items = parseTextToItems(text, shelf.type);

      if (!items.length) {
        setVisionMessage("Could not identify items from text.");
        return;
      }

      // Send to catalog lookup endpoint
      const data = await apiRequest({
        apiBase,
        path: `/api/shelves/${id}/catalog-lookup`,
        method: 'POST',
        token,
        body: { items, autoApply: true },
      });

      // Update items
      if (Array.isArray(data?.items)) {
        setItems(data.items);
      } else {
        await refreshItems();
      }

      const addedCount = (data?.results || []).filter(
        r => r.status === "created" || r.status === "linked"
      ).length;

      setVisionMessage(
        `Scanned ${items.length} lines. Added ${addedCount} items.`
      );

    } catch (err) {
      setError(err.message || "Quick scan failed");
      setVisionMessage("");
    } finally {
      setVisionLoading(false);
    }
  };

  const captureShelf = async () => {
    setError("");

    setVisionMessage("");

    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!cameraPermission.granted && !libraryPermission.granted) {
        setError("Camera and photo library permissions are required");
        return;
      }

      let selectedSource = null;
      if (cameraPermission.granted && libraryPermission.granted) {
        selectedSource = await new Promise((resolve) => {
          Alert.alert("Add Photo", "Choose how you want to add a photo", [
            { text: "Take Photo", onPress: () => resolve("camera") },
            { text: "Choose from Library", onPress: () => resolve("library") },
            { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
          ]);
        });
        if (!selectedSource) return;
      } else if (cameraPermission.granted) {
        selectedSource = "camera";
      } else {
        selectedSource = "library";
      }

      const pickerResult =
        selectedSource === "camera"
          ? await ImagePicker.launchCameraAsync({
            base64: true,
            quality: 0.5,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: false,
            exif: false,
          })
          : await ImagePicker.launchImageLibraryAsync({
            base64: true,
            quality: 0.5,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: false,
            exif: false,
          });

      if (pickerResult.canceled) return;

      const asset = pickerResult.assets?.[0];

      const processed = await ensureBase64Image(asset);
      if (!processed) {
        setError("Failed to load image");
        return;
      }

      if (scanMode === 'quick') {
        await handleQuickScan(pickerResult.assets[0].uri);
        return;
      }

      setVisionLoading(true);

      const data = await apiRequest({
        apiBase,
        path: `/api/shelves/${id}/vision`,
        method: "POST",
        token,
        body: {
          imageBase64: `data:${processed.mime};base64,${processed.base64}`,
        },
      });

      setAnalysis(data.analysis);
      setVisionMetadata(
        data && typeof data.metadata === "object" && !Array.isArray(data.metadata)
          ? data.metadata
          : null,
      );

      if (Array.isArray(data.results)) {
        // const needsEdit = data.results.filter(r => r.status === "edit_required");
        // setPendingEdits(needsEdit.map(r => r.item));
        const resultList = data.results;

        const reviewIds = resultList
          .map((r) => {
            if (r && r.needsReview) {
              return r.itemId ?? r.itemID ?? null;
            }
            if (r && (r.status === "manual_added" || r.status === "edit_required")) {
              return r.itemId ?? r.itemID ?? null;
            }
            return null;
          })
          .filter(Boolean);

        // Always set (clears old highlights if none now)
        setNeedsReviewIds(reviewIds);

        // Optional: apply updated items immediately if backend returned them
        if (Array.isArray(data?.items)) {
          setItems(data.items);
        } else {
          await refreshItems();
        }


        const addedCount = data.results.filter(
          r => r.status === "created" || r.status === "linked"
        ).length;

        setVisionMessage(
          `Detected ${data.analysis?.items?.length || 0} items. Added ${addedCount}.`
        );
      } else {
        setVisionMessage(
          `Detected ${data.analysis?.items?.length || 0} items. Added 0.`
        );
      }


    } catch (e) {
      setVisionMetadata(null);
      setError(e.message);
    } finally {
      setVisionLoading(false);
    }
  };

  const visibilityLabel = shelf?.visibility
    ? `${shelf.visibility.charAt(0).toUpperCase()}${shelf.visibility.slice(1)}`
    : null;

  /* --- Render Redesign --- */
  return (
    <ShelfDetailSyncProvider value={shelfDetailSyncValue}>
      <View style={styles.screen}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />

        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Shelf Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{shelf?.name || "Shelf"}</Text>
              <Text style={styles.subtitle}>{visibilityLabel || 'Private'} • {shelf?.type || 'Collection'}</Text>
            </View>
            <Button
              title="Edit"
              variant="secondary"
              size="sm"
              onPress={openShelfEdit}
              disabled={!shelf}
            />
          </View>

          {/* Tools / Add Section (Collapsible or Card) */}
          <Card style={styles.toolsCard}>
            <Text style={styles.sectionTitle}>Add Items</Text>
            <View style={styles.toolsRow}>
              <Button
                title="Scan / Camera"
                onPress={captureShelf}
                icon={<Ionicons name="camera" size={18} color={colors.text} />}
                style={{ flex: 1, marginRight: spacing.sm }}
                loading={visionLoading}
              />
              <Button
                title="Manual"
                variant="secondary"
                onPress={() => setManual({ ...manual, isVisible: !manual.isVisible })}
                icon={<Ionicons name="create-outline" size={18} color={colors.text} />}
                style={{ flex: 1 }}
              />
            </View>

            {/* Vision Feedback */}
            {!!visionMessage && (
              <View style={styles.visionFeedback}>
                <Text style={styles.successText}>{visionMessage}</Text>
              </View>
            )}

            {/* Scan Mode Toggle */}
            <View style={styles.scanToggleRow}>
              <TouchableOpacity onPress={() => setScanMode('quick')} style={[styles.toggleOption, scanMode === 'quick' && styles.toggleActive]}>
                <Text style={[styles.toggleText, scanMode === 'quick' && styles.toggleTextActive]}>Quick Text</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setScanMode('cloud')}
                disabled={!user?.isPremium}
                style={[styles.toggleOption, scanMode === 'cloud' && styles.toggleActive, !user?.isPremium && styles.toggleDisabled]}
              >
                <Text style={[styles.toggleText, scanMode === 'cloud' && styles.toggleTextActive]}>
                  Cloud AI {user?.isPremium ? '' : '🔒'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Manual Entry Form (Conditionally Visible or separate modal in future) */}
            {manual.isVisible && (
              <View style={styles.manualForm}>
                <Input placeholder="Title" value={manual.name} onChangeText={(v) => setManual({ ...manual, name: v })} />
                <Input placeholder="Type (Book, Game...)" value={manual.type} onChangeText={(v) => setManual({ ...manual, type: v })} />
                <Input placeholder="Description" value={manual.description} onChangeText={(v) => setManual({ ...manual, description: v })} />
                <Button title="Add Entry" onPress={addManual} fullWidth />

                <View style={styles.separator} />

                <Text style={styles.labelSmall}>Search Catalog</Text>
                <Input
                  placeholder="Search online..."
                  value={q}
                  onChangeText={(v) => {
                    setQ(v);
                    if (v.trim().length >= 2) search(v);
                    else setResults([]);
                  }}
                  leftIcon={<Ionicons name="search" size={18} color={colors.textMuted} />}
                />

                {results.length > 0 && (
                  <View style={styles.searchResults}>
                    {results.map(r => (
                      <TouchableOpacity key={r._id} style={styles.searchResultItem} onPress={() => addCollectable(r._id)}>
                        <View>
                          <Text style={styles.resultTitle}>{r.title}</Text>
                          <Text style={styles.resultSubtitle}>{r.primaryCreator} • {r.year}</Text>
                        </View>
                        <Ionicons name="add-circle" size={24} color={colors.primary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </Card>

          {/* Steam Section (Conditional) */}
          {isVideoGameShelf && (
            <Card style={styles.steamCard}>
              <View style={styles.steamHeader}>
                <Ionicons name="logo-steam" size={24} color="#FFF" style={{ marginRight: spacing.sm }} />
                <Text style={styles.sectionTitle}>Steam Library</Text>
              </View>

              {steamError ? <Text style={styles.errorText}>{steamError}</Text> : null}
              {steamMessage ? <Text style={styles.successText}>{steamMessage}</Text> : null}

              {steamLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
              ) : (
                <View>
                  <Text style={styles.steamStatus}>
                    {steamStatus?.steamId ? `Linked as ${steamStatus.personaName}` : 'Not linked'}
                  </Text>

                  <View style={styles.steamActions}>
                    {steamStatus?.steamId ? (
                      <>
                        <Button title="Preview" onPress={previewSteamLibrary} disabled={steamBusy} variant="ghost" size="sm" />
                        <Button title="Import" onPress={handleSteamImport} disabled={steamBusy} loading={steamBusy} size="sm" />
                      </>
                    ) : (
                      <Button title="Link Account" onPress={() => navigation.navigate("Account")} variant="secondary" size="sm" />
                    )}
                  </View>

                  {steamPreview.length > 0 && (
                    <View style={styles.previewContainer}>
                      <Text style={styles.labelSmall}>{steamPreview.length} games found in preview</Text>
                    </View>
                  )}
                </View>
              )}
            </Card>
          )}

          {/* Items Section */}
          <View style={styles.itemsSection}>
            <View style={styles.itemsHeader}>
              <Text style={styles.sectionTitle}>Collection ({items.length})</Text>
              {/* Sort logic could go here */}
            </View>

            {items.length === 0 ? (
              <EmptyState
                icon={<Ionicons name="albums-outline" size={48} color={colors.textMuted} />}
                title="Shelf is empty"
                description="Add items using the tools above."
              />
            ) : (
              <View style={styles.grid}>
                {sortedItems.map(item => {
                  const title = item.collectable?.title || item.manual?.name || item.collectable?.name || "Untitled";
                  const type = item.collectable?.type || item.manual?.type || shelf?.type || "Item";
                  const needsReview = needsReviewIds.includes(item.id);

                  return (
                    <Card key={item.id} style={[styles.itemCard, needsReview && styles.needsReviewCard]} contentStyle={styles.itemContent} onPress={() => {
                      if (item.collectable) openCollectable(item.collectable);
                    }}>
                      <View style={styles.itemIcon}>
                        <Ionicons name="cube-outline" size={24} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
                        <Text style={styles.itemSubtitle}>{type}</Text>
                        {needsReview && <Text style={styles.reviewLabel}>Needs Review</Text>}
                      </View>
                      <TouchableOpacity onPress={() => confirmRemove(item.id, title)} style={{ padding: 4 }}>
                        <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    </Card>
                  );
                })}
              </View>
            )}
          </View>

        </ScrollView>

        <ShelfVisionModal
          visible={visionOpen}
          onClose={closeShelfVision}
          items={items}
          apiBase={apiBase}
        />
      </View>
    </ShelfDetailSyncProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 80 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.sizes['2xl'],
    color: colors.text,
  },
  subtitle: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },

  toolsCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.sizes.lg,
    color: colors.text,
    marginBottom: spacing.md,
  },
  toolsRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },

  scanToggleRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: 2,
    marginBottom: spacing.md,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  toggleActive: {
    backgroundColor: colors.primary, // or surface logic
    backgroundColor: '#3b4b6a', // Slightly lighter
  },
  toggleText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#FFF',
  },
  toggleDisabled: {
    opacity: 0.5,
  },

  visionFeedback: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },

  manualForm: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  labelSmall: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },

  searchResults: {
    marginTop: spacing.sm,
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  resultTitle: {
    fontFamily: typography.fontFamily.bold,
    color: colors.text,
    fontSize: 14,
  },
  resultSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
  },

  steamCard: {
    backgroundColor: '#1b2838', // Steam blue-ish
    marginBottom: spacing.lg,
  },
  steamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  steamStatus: {
    color: '#c5c3c0',
    marginBottom: spacing.md,
  },
  steamActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  previewContainer: {
    marginTop: spacing.md,
  },

  itemsSection: {
    flex: 1,
  },
  itemsHeader: {
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  itemCard: {
    width: '48%', // Grid column
    marginBottom: 0,
  },
  needsReviewCard: {
    borderColor: colors.warning,
    borderWidth: 1,
  },
  itemContent: {
    flex: 1,
    gap: spacing.sm,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemTitle: {
    fontFamily: typography.fontFamily.bold,
    fontSize: 14,
    color: colors.text,
  },
  itemSubtitle: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  reviewLabel: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: 'bold',
  },

  errorContainer: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
  },
  successText: {
    color: colors.success,
  },
});
