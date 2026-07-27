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
