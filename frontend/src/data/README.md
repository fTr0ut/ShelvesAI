# Data providers

This directory defines small React context providers that wrap the Collector API.
Each provider handles fetching, exposes helper mutations, and ships a matching
`use…` hook for consuming the loaded data within the front-end app.

The providers can be combined freely; simply wrap a subtree with the provider
component and the corresponding hook will surface the latest data and helpers.
All providers accept optional `apiBase` and `token` props so tests and stories
can supply explicit endpoints or credentials when needed.

## Available providers

| Provider | Exposes |
| --- | --- |
| `ShelvesProvider` | Shelf list, pagination details, loading/error flags, `createShelf()` |
| `ShelfDetailProvider` | Shelf metadata, items, pagination helpers, mutations for updating content |
| `FeedProvider` | Social feed entries, filters, paging, `refresh()` |
| `CollectableProvider` | A single collectable record, loading/error state, `refresh()` |
| `AccountProvider` | Current user profile plus `updateAccount()` |

Import providers via `@frontend/data` and wrap any component tree that needs
access to API-backed state:

```jsx
import { ShelvesProvider, useShelves } from '@frontend/data';

function ShelfList() {
  const { shelves, loading } = useShelves();
  if (loading) return <p>Loading…</p>;
  return shelves.map((shelf) => <div key={shelf._id}>{shelf.name}</div>);
}

export function ShelvesPage() {
  return (
    <ShelvesProvider>
      <ShelfList />
    </ShelvesProvider>
  );
}
```
