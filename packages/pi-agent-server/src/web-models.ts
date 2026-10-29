/**
 * Web models (lop): chat sites such as ChatGPT, Qwen, Kimi or DeepSeek used as models through
 * the pi-chatgpt-web project, the same providers a Pi install loads as an extension.
 *
 * The connection is a custom endpoint with `api: 'pi-web'` whose base URL is that project's
 * folder. Its providers run in this process; every model is registered under `custom-endpoint`
 * (what Craft's model resolution looks up) and one stream function hands each request to the
 * provider that owns the model, with the provider/api that provider expects.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';

type ProviderConfig = Parameters<PiModelRegistry['registerProvider']>[1];
type StreamSimple = NonNullable<ProviderConfig['streamSimple']>;
type ProviderModel = NonNullable<ProviderConfig['models']>[number];

/** The custom-endpoint protocol value that selects web models. */
export const WEB_MODELS_API = 'pi-web';

/** One web model and the provider (pi-chatgpt-web, pi-qwen-web, …) that serves it. */
export interface WebModelRoute {
  provider: string;
  api: string;
  baseUrl?: string;
  streamSimple: StreamSimple;
  model: ProviderModel;
}

/** The slice of Pi's ExtensionAPI the project uses while registering (event hooks only log). */
interface RegistrationApi {
  registerProvider: (name: string, config: ProviderConfig) => void;
  on: (...args: unknown[]) => void;
}

let loadedRoot: string | null = null;
let loading: Promise<Map<string, WebModelRoute>> | null = null;

/**
 * Load the project's providers once per process (they keep per-session state and start the
 * project's bridge on first use). `root` is the project folder, e.g. `.../pi-chatgpt-web`.
 */
export function loadWebModelRoutes(
  root: string,
  importModule: (url: string) => Promise<{ register: (pi: RegistrationApi, options: { EventStream: unknown }) => Promise<void> }> = (url) => import(url),
): Promise<Map<string, WebModelRoute>> {
  if (loading && loadedRoot === root) return loading;
  loadedRoot = root;
  keepStdoutForProtocol();
  loading = (async () => {
    const entry = pathToFileURL(join(root, 'src', 'pi-extension.mjs')).href;
    const { register } = await importModule(entry);
    const providers: Array<[string, ProviderConfig]> = [];
    await register(
      { registerProvider: (name, config) => { providers.push([name, config]); }, on: () => {} },
      { EventStream: AssistantMessageEventStream },
    );
    const routes = new Map<string, WebModelRoute>();
    for (const [provider, config] of providers) {
      if (!config.streamSimple) continue;
      for (const model of config.models ?? []) {
        if (routes.has(model.id)) continue;
        routes.set(model.id, { provider, api: String(config.api ?? provider), baseUrl: config.baseUrl, streamSimple: config.streamSimple, model });
      }
    }
    if (routes.size === 0) throw new Error(`No web models registered by ${entry}`);
    return routes;
  })().catch((error) => {
    loading = null;
    loadedRoot = null;
    throw error;
  });
  return loading;
}

/**
 * Register every web model under the `custom-endpoint` provider. All of them, not only the
 * connection's list, so a mid-session model switch resolves without re-registration.
 */
export function registerWebModels(registry: PiModelRegistry, routes: Map<string, WebModelRoute>): void {
  const streamSimple: StreamSimple = (model, context, options) => {
    const route = routes.get(model.id);
    if (!route) throw new Error(`Unknown web model: ${model.id}`);
    // The provider checks that the request is for its own provider/api.
    return route.streamSimple({ ...model, provider: route.provider, api: route.api } as typeof model, context, options);
  };
  const first = routes.values().next().value as WebModelRoute;
  registry.registerProvider('custom-endpoint', {
    baseUrl: first.baseUrl,
    apiKey: 'web-session-not-an-api-key',
    api: WEB_MODELS_API as ProviderConfig['api'],
    streamSimple,
    models: [...routes.values()].map(({ model }) => ({ ...model, api: WEB_MODELS_API }) as ProviderModel),
  });
}

/** The project logs JSON events with console.log; this process's stdout carries its JSONL protocol. */
function keepStdoutForProtocol(): void {
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
}

/** Test hook: forget the loaded project. */
export function resetWebModelRoutesForTests(): void {
  loading = null;
  loadedRoot = null;
}
