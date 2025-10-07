# Plasmic Data Providers

This directory contains React provider components that wrap the Collector API and expose the results to Plasmic Studio through [`DataProvider`](https://www.plasmic.app/learn/data-queries/).

Each provider is available inside the Plasmic loader host and can be dropped into Studio just like any other component. When placed on the canvas, the provider will fetch data from the API and inject the results into the Plasmic data tree under the keys listed below.

## Available providers

| Provider | Data keys | Relevant props |
| --- | --- | --- |
| `ShelvesProvider` | `shelves`, `shelvesPagination`, `shelvesLoading`, `shelvesError` | `limit`, `skip`, `token`, `apiBase` |
| `FeedProvider` | `feedEntries`, `feedPaging`, `feedScope`, `feedFilters`, `feedLoading`, `feedError` | `scope`, `type`, `ownerId`, `since`, `limit`, `skip`, `token`, `apiBase` |
| `ShelfDetailProvider` | `shelf`, `shelfItems`, `shelfItemsPaging`, `shelfLoading`, `shelfError`, `shelfMessage` | `shelfId`, `itemLimit`, `itemSkip`, `token`, `apiBase` |
| `CollectableProvider` | `collectable`, `collectableLoading`, `collectableError` | `collectableId`, `token`, `apiBase` |
| `AccountProvider` | `account`, `accountLoading`, `accountError` | `token`, `apiBase` |

### Binding data in Studio

1. Drag a provider (for example, **Shelves Provider**) into your frame and configure the props (e.g., set `limit` to 12).
2. Add a repeated element, such as a Stack, and bind its **Data Source** to the provider's array key (`shelves`).
3. Inside the repeated element, select a text element and bind its content to one of the object fields (e.g., `currentItem.name`).
4. For metadata such as pagination, bind any component to the corresponding key (e.g., `shelvesPagination.hasMore`).

You can mix and match providers; nested components will automatically inherit the data context as long as they are rendered inside the provider instance.

### Previewing authenticated content

When designing in Plasmic Studio you may want to preview data for a specific user. Supply a JWT token via the provider's **Auth Token** prop to impersonate that user. If left blank, the provider will try to read the token from `localStorage` when running inside the main web app.

### Using providers in the app

The front-end pages use these providers directly. Each provider exports a `use…` hook (for example, `useShelves`) for consuming the loaded data and helper functions (refresh, mutations, etc.). You can use the same hooks in bespoke React components outside of Plasmic Studio.
