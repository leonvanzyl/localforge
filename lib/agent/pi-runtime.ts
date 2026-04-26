import "server-only";

import {
  AuthStorage,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { ProviderId } from "./providers/types";
import { createPiLocalModel } from "./pi-model-config";

export function createPiModelRuntime(config: {
  provider: ProviderId;
  baseUrl: string;
  model: string;
}) {
  const localModel = createPiLocalModel(config);
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(localModel.provider, "localforge");

  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(localModel.provider, {
    baseUrl: localModel.baseUrl,
    apiKey: "localforge",
    api: localModel.api,
    models: [localModel],
  });

  return {
    authStorage,
    modelRegistry,
    model: modelRegistry.find(localModel.provider, localModel.id) ?? localModel,
    baseUrl: localModel.baseUrl,
  };
}

export async function createPiResourceLoader(config: {
  cwd: string;
  systemPrompt: string;
  noContextFiles?: boolean;
}) {
  const loader = new DefaultResourceLoader({
    cwd: config.cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: config.noContextFiles ?? false,
    systemPrompt: config.systemPrompt,
  });
  await loader.reload();
  return loader;
}
