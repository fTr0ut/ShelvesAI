import { AppLayout, Button, Card, Grid, Hero, ShelfListItem } from '@frontend/components';
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

export function registerCollectorMobileComponents(_loader: PlasmicLoader) {
  // Mobile-specific components are registered in the mobile app / Plasmic host.
}

