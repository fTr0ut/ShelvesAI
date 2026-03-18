const express = require('express');

const router = express.Router();

router.get('/reset-password', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const deepLinkBase = process.env.RESET_PASSWORD_DEEP_LINK_BASE || 'shelvesai://reset-password';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reset Password</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --surface: #ffffff;
      --text: #18212b;
      --muted: #526174;
      --accent: #0f766e;
      --accent-dark: #0b5d57;
      --border: #d9e1e8;
      --danger: #b42318;
      --ok: #067647;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: radial-gradient(circle at top right, #d8f3ee, transparent 40%), var(--bg);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 16px 42px rgba(8, 15, 52, 0.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 1.6rem;
      line-height: 1.2;
    }
    p {
      margin: 0 0 16px;
      color: var(--muted);
      line-height: 1.45;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .button {
      appearance: none;
      border: 0;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 14px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      transition: background 0.2s ease;
    }
    .button.primary { background: var(--accent); color: #fff; }
    .button.primary:hover { background: var(--accent-dark); }
    .button.secondary {
      background: #fff;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .divider {
      height: 1px;
      background: var(--border);
      margin: 14px 0 18px;
    }
    form {
      display: grid;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 0.9rem;
      color: var(--muted);
    }
    input {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 11px 12px;
      font-size: 0.98rem;
      color: var(--text);
    }
    .message {
      margin-top: 10px;
      font-size: 0.92rem;
      min-height: 1.2em;
    }
    .error { color: var(--danger); }
    .success { color: var(--ok); }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Reset your password</h1>
    <p>We will try to open ShelvesAI first. If the app is unavailable, you can reset here on the web.</p>

    <div class="actions">
      <a id="open-app-link" class="button primary" href="#">Open in app</a>
      <button id="use-web-button" class="button secondary" type="button">Use web form</button>
    </div>

    <div class="divider"></div>

    <section id="web-panel" class="hidden" aria-live="polite">
      <form id="reset-form">
        <label>
          New password
          <input id="password" name="password" type="password" minlength="8" required>
        </label>
        <label>
          Confirm password
          <input id="confirmPassword" name="confirmPassword" type="password" minlength="8" required>
        </label>
        <button class="button primary" type="submit">Reset password</button>
      </form>
      <div id="message" class="message"></div>
    </section>

    <noscript>
      <p class="error">JavaScript is required for this page.</p>
    </noscript>
  </main>

  <script>
    (function () {
      const token = ${JSON.stringify(token)};
      const deepLinkBase = ${JSON.stringify(deepLinkBase)};
      const openAppLink = document.getElementById('open-app-link');
      const useWebButton = document.getElementById('use-web-button');
      const webPanel = document.getElementById('web-panel');
      const form = document.getElementById('reset-form');
      const message = document.getElementById('message');

      function setMessage(text, kind) {
        message.textContent = text;
        message.className = 'message ' + (kind || '');
      }

      function showWebPanel() {
        webPanel.classList.remove('hidden');
      }

      if (!token) {
        showWebPanel();
        setMessage('Invalid or missing reset token.', 'error');
        openAppLink.classList.add('hidden');
        useWebButton.classList.add('hidden');
        return;
      }

      const deepLink = deepLinkBase + '?token=' + encodeURIComponent(token);
      openAppLink.setAttribute('href', deepLink);

      useWebButton.addEventListener('click', showWebPanel);

      let appOpened = false;
      const onVisibilityChange = () => {
        if (document.hidden) {
          appOpened = true;
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      setTimeout(() => {
        window.location.href = deepLink;
      }, 250);

      setTimeout(() => {
        if (!appOpened) {
          showWebPanel();
        }
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }, 1600);

      fetch('/api/auth/validate-reset-token?token=' + encodeURIComponent(token))
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !payload.valid) {
            showWebPanel();
            setMessage(payload.error || 'Invalid or expired reset token.', 'error');
          }
        })
        .catch(() => {
          showWebPanel();
          setMessage('Unable to validate reset token. Try again.', 'error');
        });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!password || password.length < 8) {
          setMessage('Password must be at least 8 characters.', 'error');
          return;
        }
        if (password !== confirmPassword) {
          setMessage('Passwords do not match.', 'error');
          return;
        }

        setMessage('Resetting password...');

        try {
          const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || 'Failed to reset password.');
          }
          setMessage('Password reset successful. You can return to the app and sign in.', 'success');
          form.reset();
        } catch (err) {
          setMessage(err.message || 'Failed to reset password.', 'error');
        }
      });
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
