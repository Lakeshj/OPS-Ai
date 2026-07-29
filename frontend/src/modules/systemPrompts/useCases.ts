export type SystemPromptUseCase = {
  key: string;
  label: string;
  description: string;
  builtIn?: boolean;
};

/** Fallback labels only — dropdown list comes from GET /admin/system-prompts/use-cases */
export const getUseCaseLabel = (
  key: string,
  useCases: SystemPromptUseCase[] = []
) => useCases.find((item) => item.key === key)?.label || key;

export const isBuiltInUseCase = (
  key: string,
  useCases: SystemPromptUseCase[] = []
) => {
  const fromApi = useCases.find((item) => item.key === key)?.builtIn;
  if (typeof fromApi === "boolean") return fromApi;
  return key === "workspace_summary" || key === "bot_design";
};
