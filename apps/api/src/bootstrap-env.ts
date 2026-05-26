import { config } from 'dotenv';
import { resolve } from 'path';

// Load project-root .env. When compiled, this file lives at apps/api/dist/bootstrap-env.js,
// so the project root is three levels up. dotenv silently no-ops if the file is absent.
config({ path: resolve(__dirname, '..', '..', '..', '.env') });
