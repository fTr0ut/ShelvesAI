const fs = require('fs');
const path = require('path');

describe('auth login route aliases', () => {
  it('mounts the shared auth router on /api and /api/auth', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

    expect(serverSource).toContain("app.use('/api', authRoutes);");
    expect(serverSource).toContain("app.use('/api/auth', authRoutes);");
  });

  it('keeps the consumer login route contract on routes/auth.js', () => {
    const routesSource = fs.readFileSync(path.resolve(__dirname, '../routes/auth.js'), 'utf8');

    expect(routesSource).toContain("router.post('/login', authLimiter, requireFields(['username', 'password']), login);");
  });
});
