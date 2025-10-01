import type { PlasmicComponentLoader } from '@plasmicapp/loader-react'
import {
  CreateShelfAction as MobileCreateShelfAction,
  AddShelfItemAction as MobileAddShelfItemAction,
  SendFriendRequestAction as MobileSendFriendRequestAction,
} from '@mobile/plasmic/actions'

export function registerActions(loader: PlasmicComponentLoader) {
  loader.registerComponent(MobileCreateShelfAction, {
    name: 'CollectorMobileCreateShelfAction',
    description: 'Creates a new shelf for the authenticated viewer.',
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
  })

  loader.registerComponent(MobileAddShelfItemAction, {
    name: 'CollectorMobileAddShelfItemAction',
    description: 'Adds a collectable to a shelf and refreshes local data.',
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
  })

  loader.registerComponent(MobileSendFriendRequestAction, {
    name: 'CollectorMobileSendFriendRequestAction',
    description: 'Sends a friend request from the current viewer to the given user.',
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
  })
}

