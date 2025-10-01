import {
  AddShelfItemAction,
  CreateShelfAction,
  SendFriendRequestAction,
} from '@frontend/plasmic/actions';

type PlasmicLoader = {
  registerComponent: (...args: any[]) => void;
};

export function registerCollectorActions(loader: PlasmicLoader) {
  loader.registerComponent(CreateShelfAction, {
    name: 'CreateShelfAction',
    displayName: 'Create Shelf Action',
    description: 'Calls POST /api/shelves and exposes the API response.',
    props: {
      name: {
        type: 'string',
        displayName: 'Shelf name',
        description: 'Default name for the shelf when the action runs.',
      },
      type: {
        type: 'string',
        displayName: 'Shelf type',
        description: 'Type slug for the shelf (e.g. books, vinyl, movies).',
      },
      description: {
        type: 'string',
        displayName: 'Description',
        description: 'Optional description sent to the API.',
      },
      visibility: {
        type: 'choice',
        options: ['private', 'friends', 'public'],
        displayName: 'Visibility',
        description: 'Visibility level to persist with the new shelf.',
        defaultValueHint: 'private',
      },
      position: {
        type: 'object',
        displayName: 'Position payload',
        description: 'Optional positioning object forwarded to the API.',
      },
      apiBase: {
        type: 'string',
        displayName: 'API base URL',
        description: 'Override the API base URL; defaults to providers/env.',
      },
      children: {
        type: 'slot',
        defaultValue: null,
        description: 'Optional children rendered within the action wrapper.',
      },
    },
    styleSections: false,
    refActions: {
      run: {
        displayName: 'Create shelf',
        description: 'Execute the shelf creation request.',
        argTypes: [
          {
            name: 'overrides',
            displayName: 'Overrides',
            type: {
              type: 'object',
            },
          },
        ],
      },
    },
  });

  loader.registerComponent(AddShelfItemAction, {
    name: 'AddShelfItemAction',
    displayName: 'Add Shelf Item Action',
    description: 'Calls POST /api/shelves/:id/items to add an existing collectable.',
    props: {
      shelfId: {
        type: 'string',
        displayName: 'Shelf ID',
        description: 'Shelf id to target; inferred from ShelfDetailProvider when omitted.',
      },
      collectableId: {
        type: 'string',
        displayName: 'Collectable ID',
        description: 'Collectable id that should be added to the shelf.',
      },
      apiBase: {
        type: 'string',
        displayName: 'API base URL',
        description: 'Override the API base URL; defaults to providers/env.',
      },
      children: {
        type: 'slot',
        defaultValue: null,
      },
    },
    styleSections: false,
    refActions: {
      run: {
        displayName: 'Add item',
        description: 'Execute the add item mutation.',
        argTypes: [
          {
            name: 'overrides',
            displayName: 'Overrides',
            type: {
              type: 'object',
            },
          },
        ],
      },
    },
  });

  loader.registerComponent(SendFriendRequestAction, {
    name: 'SendFriendRequestAction',
    displayName: 'Send Friend Request Action',
    description: 'Calls POST /api/friends/request for the active viewer.',
    props: {
      targetUserId: {
        type: 'string',
        displayName: 'Target user ID',
        description: 'User id to send the request to.',
      },
      message: {
        type: 'string',
        displayName: 'Message',
        description: 'Optional request message.',
      },
      apiBase: {
        type: 'string',
        displayName: 'API base URL',
        description: 'Override the API base URL; defaults to providers/env.',
      },
      children: {
        type: 'slot',
        defaultValue: null,
      },
    },
    styleSections: false,
    refActions: {
      run: {
        displayName: 'Send request',
        description: 'Execute the friend request mutation.',
        argTypes: [
          {
            name: 'overrides',
            displayName: 'Overrides',
            type: {
              type: 'object',
            },
          },
        ],
      },
    },
  });
}
