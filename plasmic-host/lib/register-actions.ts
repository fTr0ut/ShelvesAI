import type {
  CodeComponentMeta,
  PlasmicComponentLoader,
} from '@plasmicapp/loader-react'

type MobileActionsModule = typeof import('@mobile/plasmic/actions')

let cachedMobileActions: MobileActionsModule | null | undefined

function loadMobileActions(): MobileActionsModule | null {
  if (cachedMobileActions !== undefined) {
    return cachedMobileActions
  }

  try {
    const actions = (eval('require') as typeof require)('@mobile/plasmic/actions')
    cachedMobileActions = actions as MobileActionsModule
  } catch (err) {
    console.warn('Unable to load mobile Plasmic actions for registration.', err)
    cachedMobileActions = null
  }

  return cachedMobileActions
}

export function registerActions(loader: PlasmicComponentLoader) {
  const actions = loadMobileActions()
  if (!actions) {
    return
  }

  const {
    CreateShelfAction: MobileCreateShelfAction,
    AddShelfItemAction: MobileAddShelfItemAction,
    SendFriendRequestAction: MobileSendFriendRequestAction,
  } = actions

  loader.registerComponent(MobileCreateShelfAction as any, {
    name: 'CollectorMobileCreateShelfAction',
    importPath: '@mobile/plasmic/actions',
    importName: 'CreateShelfAction',
    props: {
      name: {
        type: 'string',
        displayName: 'Name',
        description: 'Shelf name to create.',
      },
      type: {
        type: 'string',
        displayName: 'Type',
        description: 'Optional shelf type label.',
      },
      description: {
        type: 'string',
        displayName: 'Description',
        description: 'Optional description for the shelf.',
      },
      visibility: {
        type: 'choice',
        displayName: 'Visibility',
        options: ['private', 'friends', 'public'],
        description: 'Visibility level for the new shelf.',
        defaultValueHint: 'private',
      },
      payload: {
        type: 'object',
        displayName: 'Extra Payload',
        description: 'Additional properties to merge into the POST body.',
      },
      onSuccess: {
        type: 'eventHandler',
        displayName: 'onSuccess',
      },
      onError: {
        type: 'eventHandler',
        displayName: 'onError',
      },
      children: {
        type: 'slot',
        defaultValue: {
          type: 'button',
          label: 'Create Shelf',
        },
      },
    },
    providesData: true,
  } as unknown as CodeComponentMeta<any>)

  loader.registerComponent(MobileAddShelfItemAction as any, {
    name: 'CollectorMobileAddShelfItemAction',
    importPath: '@mobile/plasmic/actions',
    importName: 'AddShelfItemAction',
    props: {
      shelfId: {
        type: 'string',
        displayName: 'Shelf ID',
        description: 'Explicit shelf id. Uses surrounding shelf context if omitted.',
      },
      collectableId: {
        type: 'string',
        displayName: 'Collectable ID',
        description: 'Collectable to add to the shelf.',
      },
      payload: {
        type: 'object',
        displayName: 'Extra Payload',
        description: 'Additional body fields for the POST request.',
      },
      onSuccess: {
        type: 'eventHandler',
        displayName: 'onSuccess',
      },
      onError: {
        type: 'eventHandler',
        displayName: 'onError',
      },
      children: {
        type: 'slot',
        defaultValue: {
          type: 'button',
          label: 'Add to Shelf',
        },
      },
    },
    providesData: true,
  } as unknown as CodeComponentMeta<any>)

  loader.registerComponent(MobileSendFriendRequestAction as any, {
    name: 'CollectorMobileSendFriendRequestAction',
    importPath: '@mobile/plasmic/actions',
    importName: 'SendFriendRequestAction',
    props: {
      userId: {
        type: 'string',
        displayName: 'Target User ID',
        description: 'The user id to send the request to.',
      },
      message: {
        type: 'string',
        displayName: 'Message',
        description: 'Optional message to include with the request.',
      },
      payload: {
        type: 'object',
        displayName: 'Extra Payload',
        description: 'Additional request body fields.',
      },
      onSuccess: {
        type: 'eventHandler',
        displayName: 'onSuccess',
      },
      onError: {
        type: 'eventHandler',
        displayName: 'onError',
      },
      children: {
        type: 'slot',
        defaultValue: {
          type: 'button',
          label: 'Send Friend Request',
        },
      },
    },
    providesData: true,
  } as unknown as CodeComponentMeta<any>)
}
