import { AccountProvider, CollectableProvider, FeedProvider, ShelfDetailProvider, ShelvesProvider } from './data'

function registerProvider(loader, component, options) {
  loader.registerComponent(component, {
    providesData: true,
    ...options,
  })
}

export function registerDataProviders(loader) {
  registerProvider(loader, ShelvesProvider, {
    name: 'ShelvesProvider',
    importPath: '@mobile/plasmic/data',
    importName: 'ShelvesProvider',
    description: "Fetches the current user's shelves with pagination controls.",
    props: {
      apiBase: { type: 'string', displayName: 'API Base URL' },
      token: { type: 'string', displayName: 'Auth Token' },
      limit: { type: 'number', displayName: 'Limit', defaultValueHint: 20 },
      skip: { type: 'number', displayName: 'Skip', defaultValueHint: 0 },
    },
  })

  registerProvider(loader, FeedProvider, {
    name: 'FeedProvider',
    importPath: '@mobile/plasmic/data',
    importName: 'FeedProvider',
    description: 'Loads activity feed entries for the signed-in viewer.',
    props: {
      apiBase: { type: 'string', displayName: 'API Base URL' },
      token: { type: 'string', displayName: 'Auth Token' },
      scope: { type: 'choice', options: ['friends', 'mine', 'global', 'nearby'], defaultValueHint: 'friends' },
      type: { type: 'string', displayName: 'Shelf Type' },
      ownerId: { type: 'string', displayName: 'Owner ID' },
      since: { type: 'string', displayName: 'Since' },
      limit: { type: 'number', displayName: 'Limit', defaultValueHint: 20 },
      skip: { type: 'number', displayName: 'Skip', defaultValueHint: 0 },
    },
  })

  registerProvider(loader, ShelfDetailProvider, {
    name: 'ShelfDetailProvider',
    importPath: '@mobile/plasmic/data',
    importName: 'ShelfDetailProvider',
    description: 'Fetches a shelf, its metadata, and items.',
    props: {
      apiBase: { type: 'string', displayName: 'API Base URL' },
      token: { type: 'string', displayName: 'Auth Token' },
      shelfId: { type: 'string', displayName: 'Shelf ID', defaultValueHint: 'replace-with-shelf-id' },
      itemLimit: { type: 'number', displayName: 'Item Limit', defaultValueHint: 25 },
      itemSkip: { type: 'number', displayName: 'Item Skip', defaultValueHint: 0 },
    },
  })

  registerProvider(loader, CollectableProvider, {
    name: 'CollectableProvider',
    importPath: '@mobile/plasmic/data',
    importName: 'CollectableProvider',
    description: 'Loads a single catalog entry by id.',
    props: {
      apiBase: { type: 'string', displayName: 'API Base URL' },
      token: { type: 'string', displayName: 'Auth Token' },
      collectableId: { type: 'string', displayName: 'Collectable ID', defaultValueHint: 'replace-with-collectable-id' },
    },
  })

  registerProvider(loader, AccountProvider, {
    name: 'AccountProvider',
    importPath: '@mobile/plasmic/data',
    importName: 'AccountProvider',
    description: 'Loads account details for the current viewer.',
    props: {
      apiBase: { type: 'string', displayName: 'API Base URL' },
      token: { type: 'string', displayName: 'Auth Token' },
    },
  })
}
