import { KeywordAssistant } from "@/modules/shared/types";
import { keywordAssistantApiService } from "./api";

export const ASSISTANT_CATEGORIES = [
  "General",
  "SEO",
  "Content Creation",
  "Marketing",
  "Sales",
  "Design",
  "Development",
  "Research",
  "Data Analysis",
  "Project Management",
];

export const ASSISTANT_TEMPLATES = {
  SEO: [
    {
      name: "SEO Content Optimizer",
      taskType: "SEO",
      description: "Optimize content for search engines with focus on keywords",
      promptTemplate:
        "Analyze the following content and provide SEO optimization suggestions focusing on the keyword '{keyword}': \n\n{content}",
      category: "SEO",
    },
    {
      name: "Title Tag Generator",
      taskType: "SEO",
      description: "Generate SEO-friendly title tags for web pages",
      promptTemplate:
        "Create 5 SEO-friendly title tags (under 60 characters) for a page about {topic} targeting the keyword {mainKeyword}.",
      category: "SEO",
    },
  ],
  Content: [
    {
      name: "Blog Post Writer",
      taskType: "Content Creation",
      description: "Generate blog post content with customizable tone",
      promptTemplate:
        "Write a {wordCount} word blog post about {topic} targeting {audience}. Use a {tone} tone of voice.",
      category: "Content Creation",
    },
    {
      name: "Article Summarizer",
      taskType: "Content Creation",
      description: "Create concise summaries of long-form content",
      promptTemplate:
        "Summarize the following article in 3-5 key points:\n\n{article}",
      category: "Content Creation",
    },
  ],
  Marketing: [
    {
      name: "Social Media Caption Creator",
      taskType: "Social Media Marketing",
      description: "Generate engaging captions for social media posts",
      promptTemplate:
        "Write 3 engaging social media captions for {platform} about {topic} including relevant hashtags.",
      category: "Marketing",
    },
    {
      name: "Email Subject Line Generator",
      taskType: "Email Marketing",
      description: "Create high-converting email subject lines",
      promptTemplate:
        "Generate 5 compelling email subject lines for a {campaignType} campaign targeting {audience}.",
      category: "Marketing",
    },
  ],
};

export type AssistantTemplate =
  (typeof ASSISTANT_TEMPLATES)[keyof typeof ASSISTANT_TEMPLATES][number];

export const getTemplateByName = (name: string) => {
  for (const templates of Object.values(ASSISTANT_TEMPLATES)) {
    const template = templates.find((candidate) => candidate.name === name);
    if (template) return template;
  }
  return null;
};

export const keywordAssistantService = {
  getByCategory: async (category: string): Promise<KeywordAssistant[]> => {
    const allAssistants = await keywordAssistantApiService.getAll();
    return allAssistants.filter(
      (assistant) => assistant.taskType === category
    );
  },

  getPopular: async (): Promise<KeywordAssistant[]> => {
    const allAssistants = await keywordAssistantApiService.getAll();
    return allAssistants.slice(0, 5);
  },

  getFeatured: async (): Promise<KeywordAssistant[]> => {
    const allAssistants = await keywordAssistantApiService.getAll();
    return allAssistants.slice(0, 3);
  },

  importTemplate: async (
    templateName: string
  ): Promise<KeywordAssistant | null> => {
    const template = getTemplateByName(templateName);
    if (!template) {
      return null;
    }

    return await keywordAssistantApiService.create({
      name: template.name,
      taskType: template.taskType,
      capabilityType: "chat",
      model: "gpt-4o-mini",
      promptTemplate: template.promptTemplate,
      description: template.description,
    });
  },

  ...keywordAssistantApiService,
};
