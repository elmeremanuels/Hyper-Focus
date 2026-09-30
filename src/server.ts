import { createApp } from './app.js';
import { getEnv } from './config/env.js';

const env = getEnv();
const app = createApp({ whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN });

app.listen(env.PORT, () => {
  console.log(`hyperfocus-web listening on port ${env.PORT} (${env.NODE_ENV})`);
});
