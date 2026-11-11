import { createApp } from './app.js';
import { dbPath } from './db.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`MobilRenfo-Session démarré sur http://${HOST}:${PORT} (base: ${dbPath()})`);
});

export { app, server };
