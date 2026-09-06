import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins = [react(), tailwindcss()];
  try {
    // Optional local plugin, not present in every checkout — resolved at runtime.
    const optionalSourceTags = './.vite-source-tags.js';
    const m = (await import(/* @vite-ignore */ optionalSourceTags)) as {
      sourceTags: () => unknown;
    };
    plugins.push(m.sourceTags() as never);
  } catch {
    // Plugin absent — continue with the standard plugin stack.
  }

  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);
  const processEnvDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    plugins,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: processEnvDefines,
  };
})
