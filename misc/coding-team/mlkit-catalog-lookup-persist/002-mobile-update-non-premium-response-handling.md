# Task 002 — Mobile: Update non-premium scan response handling

## Context

`ShelfDetailScreen.js` has two code paths in `handleCameraScan` that call `/api/shelves/:shelfId/catalog-lookup`:

1. **Non-premium path** (line ~692-704): Called when `premiumEnabled` is false.
2. **Quota-exceeded fallback** (line ~731-743): Called when premium vision returns a 429 quota error.

Both paths currently show a generic "Detected X items" alert using `data.analysis.items.length`, with no indication of how many were added vs. need review, and no "Review Now" navigation.

The API now returns `{ addedCount, needsReviewCount, analysis, items }` from this endpoint (Task 001).

## Objective

Update both non-premium code paths to show the same result UX as the premium vision path: "X items added, Y need review" with a "Review Now" option when items need review.

## Scope

**File:** `mobile/src/screens/ShelfDetailScreen.js` — function `handleCameraScan`

### Path 1: Non-premium (lines ~692-704)

Current code after the `/catalog-lookup` call:
```js
if (Array.isArray(data?.items)) {
    setItems(data.items);
}
const detected = data?.analysis?.items?.length || parsedItems.length;
Alert.alert('Scan complete', `Detected ${detected} items.`);
```

Replace with:
```js
if (Array.isArray(data?.items)) {
    setItems(data.items);
} else {
    loadShelf();
}
const addedCount = data?.addedCount || 0;
const needsReviewCount = data?.needsReviewCount || 0;

if (needsReviewCount > 0) {
    Alert.alert(
        'Scan Complete',
        `${addedCount} item${addedCount !== 1 ? 's' : ''} added. ${needsReviewCount} item${needsReviewCount !== 1 ? 's' : ''} need review.`,
        [
            { text: 'Later', style: 'cancel' },
            { text: 'Review Now', onPress: () => navigation.navigate('Unmatched') },
        ]
    );
} else if (addedCount > 0) {
    Alert.alert('Scan Complete', `${addedCount} item${addedCount !== 1 ? 's' : ''} added to your shelf.`);
} else {
    Alert.alert('Scan Complete', 'No new items were added. They may already be on your shelf.');
}
```

### Path 2: Quota-exceeded fallback (lines ~731-743)

Apply the exact same pattern. Current code:
```js
if (Array.isArray(fallbackData?.items)) {
    setItems(fallbackData.items);
}
const detected = fallbackData?.analysis?.items?.length || parsedItems.length;
Alert.alert('Scan complete', `Detected ${detected} items using on-device scanning.`);
```

Replace with the same alert logic, using `fallbackData` instead of `data`.

## Non-goals / Later

- Do not change the premium vision path (it already has proper UX via the polling modal).
- Do not add a processing modal / progress indicator to the non-premium path.
- Do not change the MLKit OCR extraction or `parseTextToItems` logic.

## Constraints / Caveats

- `loadShelf` is already defined in the component and available in scope.
- `navigation` is available from the component props.
- The `Unmatched` screen route is already registered in the navigator (used by the premium path).
