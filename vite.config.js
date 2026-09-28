import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The WebLLM runtime is a large, separate chunk loaded only when a model is requested.
    chunkSizeWarningLimit: 7000,
  },
});
