import 'react-native-gesture-handler'
import './src/polyfills'
import { registerRootComponent } from 'expo'
import * as Sentry from '@sentry/react-native'
import App from './src/App'

Sentry.init({
  dsn: 'https://8b580853402330103cf1c3bd790598c6@o4511065613205504.ingest.us.sentry.io/4511065625919488',
  debug: __DEV__,
  enableNative: true,
  enableNativeCrashHandling: true,
  environment: __DEV__ ? 'development' : 'production',
})

Sentry.setTag('runtime', 'expo')

registerRootComponent(App)

