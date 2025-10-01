export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Plasmic Host</h1>
      <p>
        This Next.js app exposes <code>/plasmic-host</code> and{' '}
        <code>/plasmic-loader.json</code> for Plasmic Studio. Update the
        environment variables in <code>.env.local</code> to point at your Express
        backend and Plasmic projects.
      </p>
    </main>
  );
}
