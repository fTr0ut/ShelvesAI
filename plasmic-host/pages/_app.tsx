import type { AppProps } from 'next/app';
import '../styles/globals.css';
import '@shared/styles/app.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
