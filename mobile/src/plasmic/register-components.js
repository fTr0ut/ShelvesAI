import AppLayout from '../components/ui/AppLayout'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Grid from '../components/ui/Grid'
import Hero from '../components/ui/Hero'
import ShelfListItem from '../components/ui/ShelfListItem'

export function registerCollectorMobileComponents(loader) {
  loader.registerComponent(Button, {
    name: 'CollectorMobileButton',
    props: {
      children: { type: 'slot', defaultValue: { type: 'text', value: 'Tap me' } },
      variant: { type: 'choice', options: ['default', 'primary', 'ghost', 'danger'], defaultValue: 'default' },
      fullWidth: { type: 'boolean', defaultValue: false },
      disabled: { type: 'boolean', defaultValue: false },
      startIcon: { type: 'slot', defaultValue: null },
      endIcon: { type: 'slot', defaultValue: null },
    },
  })

  loader.registerComponent(Card, {
    name: 'CollectorMobileCard',
    props: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      padding: { type: 'choice', options: ['default', 'compact'], defaultValue: 'default' },
      actions: { type: 'slot', defaultValue: null },
      children: { type: 'slot' },
      footer: { type: 'slot', defaultValue: null },
    },
  })

  loader.registerComponent(AppLayout, {
    name: 'CollectorMobileAppLayout',
    props: {
      children: { type: 'slot' },
      scrollable: { type: 'boolean', defaultValue: true },
    },
  })

  loader.registerComponent(Hero, {
    name: 'CollectorMobileHero',
    props: {
      eyebrow: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      actions: { type: 'slot', defaultValue: null },
      children: { type: 'slot' },
    },
  })

  loader.registerComponent(Grid, {
    name: 'CollectorMobileGrid',
    props: {
      columns: { type: 'choice', options: [1, 2, 3], defaultValue: 1 },
      gap: { type: 'choice', options: ['none', 'sm', 'md', 'lg'], defaultValue: 'md' },
      children: { type: 'slot' },
    },
  })

  loader.registerComponent(ShelfListItem, {
    name: 'CollectorMobileShelfListItem',
    props: {
      name: { type: 'string' },
      typeLabel: { type: 'string' },
      visibilityLabel: { type: 'string' },
      description: { type: 'string' },
      onPress: { type: 'eventHandler', displayName: 'onPress' },
      children: { type: 'slot', defaultValue: null },
      actions: { type: 'slot', defaultValue: null },
    },
  })
}
