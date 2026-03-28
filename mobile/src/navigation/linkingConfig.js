import { getPathFromState as defaultGetPathFromState, getStateFromPath as defaultGetStateFromPath } from '@react-navigation/core';

const linkingRoutes = {
  screens: {
    Login: 'login',
    ResetPassword: 'reset-password',
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
    FeedDetail: 'app/events/:id/:slug?',
    ShelfDetail: 'app/shelves/:id/:slug?',
    CollectableDetail: {
      path: 'app/collectables/:collectableId/:slug?',
      parse: {
        collectableId: (value) => String(value || ''),
      },
    },
    Profile: {
      path: 'app/profiles/:username/:slug?',
      parse: {
        username: (value) => String(value || ''),
      },
    },
    Wishlist: 'wishlist/:id',
    ListDetail: 'list/:id',
    Favorites: 'favorites',
    Account: 'account',
    FriendSearch: 'friends/search',
    Notifications: 'notifications',
  },
};

function normalizePath(path = '') {
  const trimmed = String(path || '').replace(/^\/+/, '');
  if (!trimmed) return trimmed;

  if (trimmed.startsWith('app/')) {
    if (trimmed.startsWith('app/collectable/')) {
      return trimmed.replace(/^app\/collectable\//, 'app/collectables/');
    }
    if (trimmed.startsWith('app/shelf/')) {
      return trimmed.replace(/^app\/shelf\//, 'app/shelves/');
    }
    if (trimmed.startsWith('app/feed/')) {
      return trimmed.replace(/^app\/feed\//, 'app/events/');
    }
    if (trimmed.startsWith('app/event/')) {
      return trimmed.replace(/^app\/event\//, 'app/events/');
    }
    if (trimmed.startsWith('app/manual/')) {
      return trimmed.replace(/^app\/manual\//, 'app/manuals/');
    }
    if (trimmed.startsWith('app/profile/')) {
      return trimmed.replace(/^app\/profile\//, 'app/profiles/');
    }
    return trimmed;
  }

  if (trimmed.startsWith('profile/')) {
    return trimmed.replace(/^profile\//, 'app/profiles/');
  }
  if (trimmed.startsWith('profiles/')) {
    return `app/${trimmed}`;
  }
  if (trimmed.startsWith('collectable/')) {
    return trimmed.replace(/^collectable\//, 'app/collectables/');
  }
  if (trimmed.startsWith('collectables/')) {
    return `app/${trimmed}`;
  }
  if (trimmed.startsWith('manual/')) {
    return trimmed.replace(/^manual\//, 'app/manuals/');
  }
  if (trimmed.startsWith('manuals/')) {
    return `app/${trimmed}`;
  }
  if (trimmed.startsWith('shelf/')) {
    return trimmed.replace(/^shelf\//, 'app/shelves/');
  }
  if (trimmed.startsWith('event/')) {
    return trimmed.replace(/^event\//, 'app/events/');
  }
  if (trimmed.startsWith('events/')) {
    return `app/${trimmed}`;
  }
  if (trimmed.startsWith('feed/')) {
    return trimmed.replace(/^feed\//, 'app/events/');
  }

  return trimmed;
}

function getManualDeepLinkState(path) {
  const match = /^app\/manuals\/([^/?#]+)(?:\/([^/?#]+))?$/.exec(path);
  if (!match) return null;

  const manualId = decodeURIComponent(match[1]);
  const slug = match[2] ? decodeURIComponent(match[2]) : undefined;

  return {
    index: 0,
    routes: [
      {
        name: 'CollectableDetail',
        params: {
          manualId,
          ...(slug ? { slug } : {}),
        },
      },
    ],
  };
}

const linkingConfig = {
  prefixes: ['shelvesai://', 'https://shelvesai.com', 'https://www.shelvesai.com'],
  config: linkingRoutes,
  getStateFromPath(path, options) {
    const normalizedPath = normalizePath(path);
    const manualState = getManualDeepLinkState(normalizedPath);
    if (manualState) return manualState;
    return defaultGetStateFromPath(normalizedPath, options || linkingRoutes);
  },
  getPathFromState(state, options) {
    return defaultGetPathFromState(state, options || linkingRoutes);
  },
};

export default linkingConfig;
