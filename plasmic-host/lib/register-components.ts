import { AppLayout, Button, Card, Grid, Hero, ShelfListItem } from '@frontend/components';
import {
  AppLayout as MobileAppLayout,
  Button as MobileButton,
  Card as MobileCard,
  Grid as MobileGrid,
  Hero as MobileHero,
  ShelfListItem as MobileShelfListItem,
} from '@mobile/components/ui';

type PlasmicLoader = {
  registerComponent: (...args: any[]) => void;
};

export function registerCollectorComponents(loader: PlasmicLoader) {
  loader.registerComponent(Button, {
    name: 'CollectorButton',
    props: {
      children: {
        type: 'slot',
        defaultValue: { type: 'text', value: 'Button' },
      },
      variant: {
        type: 'choice',
        options: ['default', 'primary', 'ghost', 'danger'],
        defaultValue: 'default',
      },
      href: { type: 'string' },
      fullWidth: { type: 'boolean', defaultValue: false },
      disabled: { type: 'boolean', defaultValue: false },
      startIcon: {
        type: 'slot',
        defaultValue: null,
      },
      endIcon: {
        type: 'slot',
        defaultValue: null,
      },
    },
  });

  loader.registerComponent(Card, {
    name: 'CollectorCard',
    props: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      padding: {
        type: 'choice',
        options: ['default', 'compact'],
        defaultValue: 'default',
      },
      actions: {
        type: 'slot',
        defaultValue: null,
      },
      children: {
        type: 'slot',
      },
      footer: {
        type: 'slot',
        defaultValue: null,
      },
    },
  });

  loader.registerComponent(AppLayout, {
    name: 'CollectorAppLayout',
    props: {
      children: {
        type: 'slot',
      },
    },
  });

  loader.registerComponent(Hero, {
    name: 'CollectorHero',
    props: {
      eyebrow: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      children: { type: 'slot' },
      actions: { type: 'slot', defaultValue: null },
    },
  });

  loader.registerComponent(Grid, {
    name: 'CollectorGrid',
    props: {
      columns: {
        type: 'choice',
        options: [1, 2, 3],
        defaultValue: 1,
      },
      children: { type: 'slot' },
    },
  });

  loader.registerComponent(ShelfListItem, {
    name: 'CollectorShelfListItem',
    props: {
      name: { type: 'string' },
      typeLabel: { type: 'string' },
      visibilityLabel: { type: 'string' },
      description: { type: 'string' },
      href: { type: 'string' },
      children: { type: 'slot', defaultValue: null },
      actions: { type: 'slot', defaultValue: null },
    },
  });
}

export function registerCollectorMobileComponents(loader: PlasmicLoader) {
  loader.registerComponent(MobileButton, {
    name: 'CollectorMobileButton',
    props: {
      children: {
        type: 'slot',
        defaultValue: { type: 'text', value: 'Tap me' },
      },
      variant: {
        type: 'choice',
        options: ['default', 'primary', 'ghost', 'danger'],
        defaultValue: 'default',
      },
      fullWidth: { type: 'boolean', defaultValue: false },
      disabled: { type: 'boolean', defaultValue: false },
      startIcon: { type: 'slot', defaultValue: null },
      endIcon: { type: 'slot', defaultValue: null },
    },
  });

  loader.registerComponent(MobileCard, {
    name: 'CollectorMobileCard',
    props: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      padding: {
        type: 'choice',
        options: ['default', 'compact'],
        defaultValue: 'default',
      },
      actions: { type: 'slot', defaultValue: null },
      children: { type: 'slot' },
      footer: { type: 'slot', defaultValue: null },
    },
  });

  loader.registerComponent(MobileAppLayout, {
    name: 'CollectorMobileAppLayout',
    props: {
      children: { type: 'slot' },
      scrollable: { type: 'boolean', defaultValue: true },
    },
  });

  loader.registerComponent(MobileHero, {
    name: 'CollectorMobileHero',
    props: {
      eyebrow: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      actions: { type: 'slot', defaultValue: null },
      children: { type: 'slot', defaultValue: null },
    },
  });

  loader.registerComponent(MobileGrid, {
    name: 'CollectorMobileGrid',
    props: {
      columns: {
        type: 'choice',
        options: [1, 2, 3],
        defaultValue: 1,
      },
      gap: {
        type: 'number',
        defaultValue: 16,
      },
      children: { type: 'slot' },
    },
  });

  loader.registerComponent(MobileShelfListItem, {
    name: 'CollectorMobileShelfListItem',
    props: {
      name: { type: 'string' },
      typeLabel: { type: 'string' },
      visibilityLabel: { type: 'string' },
      description: { type: 'string' },
      actions: { type: 'slot', defaultValue: null },
      children: { type: 'slot', defaultValue: null },
    },
  });
}
