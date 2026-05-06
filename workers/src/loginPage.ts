export const loginPage = (opts: { error?: string; next?: string } = {}): string => {
  const errorHtml = opts.error
    ? `<p class="error">${escapeHtml(opts.error)}</p>`
    : "";
  const nextField = opts.next
    ? `<input type="hidden" name="next" value="${escapeHtml(opts.next)}">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Excalidraw — Sign in</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8f9fa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.10);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 380px;
    }
    h1 {
      margin: 0 0 1.5rem;
      font-size: 1.4rem;
      font-weight: 600;
      color: #1a1a2e;
      text-align: center;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: #555;
      margin-bottom: 0.3rem;
    }
    input[type=text], input[type=password] {
      display: block;
      width: 100%;
      padding: 0.6rem 0.8rem;
      border: 1px solid #d0d5dd;
      border-radius: 6px;
      font-size: 1rem;
      margin-bottom: 1rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #6965db; }
    button {
      width: 100%;
      padding: 0.7rem;
      background: #6965db;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #5350c4; }
    .error {
      background: #fff1f1;
      border: 1px solid #ffc5c5;
      color: #c0392b;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Excalidraw</h1>
    ${errorHtml}
    <form method="POST" action="/api/auth/login">
      ${nextField}
      <label for="username">Username</label>
      <input id="username" type="text" name="username" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
