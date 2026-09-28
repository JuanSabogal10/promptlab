# Promptlab

Promptlab tests a prompt in several generated scenarios and shows each complete response with its score, rubric breakdown, explanation, and evidence. All model inference runs in the visitor's browser through WebLLM and WebGPU. Prompts and generated responses are not sent to the Promptlab server or a cloud inference API.

## Local development

Requirements: Node.js 20.19+ and a recent browser with WebGPU support. WebGPU availability also depends on the operating system, graphics driver, and device.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Select a model and choose **Cargar modelo en este navegador**, or start an evaluation to load it on demand.

The first model load downloads its weights and supporting runtime files from the model host. WebLLM stores downloaded assets in the browser cache where available; later loads may reuse that cache. Model files can take substantial disk space and inference requires suitable GPU memory. The Llama 3.2 1B model is the smaller option; 3B requires more memory and may be slower. No model download begins until the visitor loads a model or starts an evaluation.

## Production build and Vercel

```sh
npm install
npm run build
```

Vite writes the static site to `dist/`. The included Vercel configuration sets this as the build output. No server-side model runtime, API key, Ollama service, or secret is required. The static site itself can be hosted publicly; each visitor downloads model assets to their own browser and runs inference on their own device. Use HTTPS for production so browser GPU features and persistent cache APIs are available.

## Evaluation flow

The chosen browser model performs all three stages serially: infer task criteria and create the requested dataset, run the original prompt for each scenario, then evaluate each complete response against the selected rubric. Built-in and custom criteria have relative weights normalized to 100%. The final scenario score is calculated in the browser as a deterministic weighted average of criterion scores, clamped to 1–5; the model does not supply the overall score.

WebLLM exposes supported prebuilt models and their WebGPU requirements. Promptlab offers a curated subset of the library's prebuilt Llama 3.2 model IDs. A browser without WebGPU support, or a device without enough compatible GPU memory, cannot run evaluation; the UI reports this rather than forwarding prompts to a server.
