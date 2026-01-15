const linkingConfig = {
  prefixes: ['shelvesai://'],
  config: {
    screens: {
      Login: 'login',
      OnboardingIntro: 'onboarding',
      UsernameSetup: 'onboarding/username',
      OnboardingProfileRequired: 'onboarding/profile',
      OnboardingProfileOptional: 'onboarding/profile-optional',
      Main: {
        screens: {
          Home: 'feed',
          Shelves: 'shelves',
        },
      },
      FeedDetail: 'feed/:id',
      ShelfDetail: 'shelf/:id',
      CollectableDetail: 'collectable/:id',
      Profile: 'profile/:username',
      Wishlist: 'wishlist/:id',
      ListDetail: 'list/:id',
      Favorites: 'favorites',
      Account: 'account',
      FriendSearch: 'friends/search',
      Notifications: 'notifications',
    },
  },
};

export default linkingConfig;
