import type { ComponentType } from 'react'
import type { PlasmicComponentLoader } from '@plasmicapp/loader-react'
import type { CodeComponentMeta } from '@plasmicapp/host'
import {
  AccountProvider,
  CollectableProvider,
  FeedProvider,
  ShelfDetailProvider,
  ShelvesProvider,
} from '../../frontend/src/plasmic/data'

function registerProvider(
  loader: PlasmicComponentLoader,
  component: ComponentType<any>,
  options: CodeComponentMeta<any>,
) {
  loader.registerComponent(
    component as any,
    {
      providesData: true,
      ...(options as unknown as Record<string, any>),
    } as unknown as CodeComponentMeta<any>,
  )
}

export function registerDataProviders(loader: PlasmicComponentLoader) {
  registerProvider(loader, ShelvesProvider, {
    name: 'ShelvesProvider',
    importPath: '../../frontend/src/plasmic/data',
    importName: 'ShelvesProvider',
    description: 'Fetches the current user\'s shelves with pagination controls.',
    props: {
      apiBase: {
        type: 'string',
        displayName: 'API Base URL',
        description: 'Override the API base URL. Defaults to VITE_API_BASE.',
      },
      token: {
        type: 'string',
        displayName: 'Auth Token',
        description: 'Optional JWT for previewing as a specific user.',
      },
      limit: {
        type: 'number',
        displayName: 'Limit',
        description: 'Number of shelves to fetch per page (limit query param).',
        defaultValueHint: 20,
      },
      skip: {
        type: 'number',
        displayName: 'Skip',
        description: 'Number of shelves to skip (skip query param).',
        defaultValueHint: 0,
      },
    },
  })

  registerProvider(loader, FeedProvider, {
    name: 'FeedProvider',
    importPath: '../../frontend/src/plasmic/data',
    importName: 'FeedProvider',
    description: 'Loads activity feed entries for the signed-in viewer.',
    props: {
      apiBase: {
        type: 'string',
        displayName: 'API Base URL',
      },
      token: {
        type: 'string',
        displayName: 'Auth Token',
      },
      scope: {
        type: 'choice',
        options: ['friends', 'mine', 'global', 'nearby'],
        displayName: 'Scope',
        description: 'Maps to the scope query parameter.',
        defaultValueHint: 'friends',
      },
      type: {
        type: 'string',
        displayName: 'Shelf Type',
        description: 'Filter feed by shelf type (type query param).',
      },
      ownerId: {
        type: 'string',
        displayName: 'Owner ID',
        description: 'Filter entries by ownerId query param.',
      },
      since: {
        type: 'string',
        displayName: 'Since',
        description: 'ISO date to filter entries updated after this time (since query param).',
      },
      limit: {
        type: 'number',
        displayName: 'Limit',
        description: 'Feed page size (limit query param).',
        defaultValueHint: 20,
      },
      skip: {
        type: 'number',
        displayName: 'Skip',
        description: 'Offset into feed results (skip query param).',
        defaultValueHint: 0,
      },
    },
  })

  registerProvider(loader, ShelfDetailProvider, {
    name: 'ShelfDetailProvider',
    importPath: '../../frontend/src/plasmic/data',
    importName: 'ShelfDetailProvider',
    description: 'Fetches a shelf, its metadata, and items.',
    props: {
      apiBase: {
        type: 'string',
        displayName: 'API Base URL',
      },
      token: {
        type: 'string',
        displayName: 'Auth Token',
      },
      shelfId: {
        type: 'string',
        displayName: 'Shelf ID',
        description: 'The shelfId path parameter.',
        defaultValueHint: 'replace-with-shelf-id',
      },
      itemLimit: {
        type: 'number',
        displayName: 'Item Limit',
        description: 'Limit items per page (limit query param).',
        defaultValueHint: 25,
      },
      itemSkip: {
        type: 'number',
        displayName: 'Item Skip',
        description: 'Skip items for pagination (skip query param).',
        defaultValueHint: 0,
      },
    },
  })

  registerProvider(loader, CollectableProvider, {
    name: 'CollectableProvider',
    importPath: '../../frontend/src/plasmic/data',
    importName: 'CollectableProvider',
    description: 'Loads a single catalog entry by id.',
    props: {
      apiBase: {
        type: 'string',
        displayName: 'API Base URL',
      },
      token: {
        type: 'string',
        displayName: 'Auth Token',
      },
      collectableId: {
        type: 'string',
        displayName: 'Collectable ID',
        description: 'Collectable id path parameter.',
        defaultValueHint: 'replace-with-collectable-id',
      },
    },
  })

  registerProvider(loader, AccountProvider, {
    name: 'AccountProvider',
    importPath: '../../frontend/src/plasmic/data',
    importName: 'AccountProvider',
    description: 'Loads account details for the current viewer.',
    props: {
      apiBase: {
        type: 'string',
        displayName: 'API Base URL',
      },
      token: {
        type: 'string',
        displayName: 'Auth Token',
      },
    },
  })
}
