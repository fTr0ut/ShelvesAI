import { AddShelfItemAction, CreateShelfAction, SendFriendRequestAction } from './actions'

export function registerActions(loader) {
  loader.registerComponent(CreateShelfAction, {
    name: 'CollectorMobileCreateShelfAction',
    importPath: '@mobile/plasmic/actions',
    importName: 'CreateShelfAction',
    props: {
      name: { type: 'string', displayName: 'Name' },
      type: { type: 'string', displayName: 'Type' },
      description: { type: 'string', displayName: 'Description' },
      visibility: { type: 'choice', options: ['private', 'friends', 'public'], defaultValueHint: 'private' },
      payload: { type: 'object', displayName: 'Extra Payload' },
      onSuccess: { type: 'eventHandler', displayName: 'onSuccess' },
      onError: { type: 'eventHandler', displayName: 'onError' },
      children: {
        type: 'slot',
        defaultValue: { type: 'button', label: 'Create Shelf' },
      },
    },
    providesData: true,
  })

  loader.registerComponent(AddShelfItemAction, {
    name: 'CollectorMobileAddShelfItemAction',
    importPath: '@mobile/plasmic/actions',
    importName: 'AddShelfItemAction',
    props: {
      shelfId: { type: 'string', displayName: 'Shelf ID' },
      collectableId: { type: 'string', displayName: 'Collectable ID' },
      payload: { type: 'object', displayName: 'Extra Payload' },
      onSuccess: { type: 'eventHandler', displayName: 'onSuccess' },
      onError: { type: 'eventHandler', displayName: 'onError' },
      children: {
        type: 'slot',
        defaultValue: { type: 'button', label: 'Add to Shelf' },
      },
    },
    providesData: true,
  })

  loader.registerComponent(SendFriendRequestAction, {
    name: 'CollectorMobileSendFriendRequestAction',
    importPath: '@mobile/plasmic/actions',
    importName: 'SendFriendRequestAction',
    props: {
      userId: { type: 'string', displayName: 'Target User ID' },
      message: { type: 'string', displayName: 'Message' },
      payload: { type: 'object', displayName: 'Extra Payload' },
      onSuccess: { type: 'eventHandler', displayName: 'onSuccess' },
      onError: { type: 'eventHandler', displayName: 'onError' },
      children: {
        type: 'slot',
        defaultValue: { type: 'button', label: 'Send Friend Request' },
      },
    },
    providesData: true,
  })
}
