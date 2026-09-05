
import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChatMessage, KeywordAssistant } from "@/lib/types";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { workflowsApi } from "@/modules/workflows/api";
import type { Workflow } from "@/modules/workflows/types";
import {
  filterWorkflowMentions,
  getActiveHashtagQuery,
  insertWorkflowMention,
  mentionsToWorkflowReferences,
  type ResolvedWorkflowMention,
  type WorkflowMentionOption,
} from "@/modules/workflows/workflowCopilotMentions";

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (
    message: string,
    opts?: { workflowReferences?: Array<{ workflowId: string }> }
  ) => void;
  isGenerating: boolean;
  selectedAssistant?: KeywordAssistant;
  onAssistantSelect: (assistant: KeywordAssistant) => void;
  availableAssistants: KeywordAssistant[];
  workspaceId?: string;
}

const TypingIndicator = () => (
  <div className="flex items-center space-x-1 p-4">
    <div className="flex space-x-1">
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
    </div>
    <span className="text-sm text-gray-500 ml-2">AI is typing...</span>
  </div>
);

const ChatBubble = ({ message, isUser }: { message: ChatMessage; isUser: boolean }) => {
  return (
    <div
      className={cn(
        "chat-bubble flex w-full",
        isUser ? "chat-bubble-user justify-end" : "chat-bubble-ai justify-start"
      )}
    >
      <div
        className={cn(
          "chat-bubble-row flex w-full gap-3 p-4",
          isUser ? "flex-row-reverse" : "flex-row"
        )}
      >
        <div
          className={cn(
            "chat-bubble-avatar flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
            isUser ? "bg-blue-600" : "bg-green-600"
          )}
        >
          {isUser ? (
            <User className="h-4 w-4 text-white" />
          ) : (
            <Bot className="h-4 w-4 text-white" />
          )}
        </div>
        <div
          className={cn(
            "chat-bubble-content min-w-0 max-w-[90%] overflow-hidden rounded-2xl px-4 py-3 shadow-sm",
            isUser
              ? "bg-blue-600 text-white"
              : "border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          )}
        >
          {isUser ? (
            <div className="chat-bubble-text break-words text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          ) : (
            <MarkdownMessage
              content={message.content}
              className="chat-bubble-markdown text-sm leading-relaxed"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const ChatInterface = ({
  messages,
  onSendMessage,
  isGenerating,
  onAssistantSelect,
  availableAssistants,
  workspaceId,
}: ChatInterfaceProps) => {
  const [prompt, setPrompt] = useState("");
  const [showAssistants, setShowAssistants] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [mentions, setMentions] = useState<ResolvedWorkflowMention[]>([]);
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowMentionOption[]>(
    []
  );
  const [wfPickerIndex, setWfPickerIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    workflowsApi
      .list(workspaceId)
      .then((rows: Workflow[]) => {
        if (cancelled) return;
        setWorkflowOptions(
          (rows || [])
            .filter((w) => !w.isDeleted)
            .map((w) => ({
              workflowId: w.id,
              name: w.name,
              status: w.status,
            }))
        );
      })
      .catch(() => {
        if (!cancelled) setWorkflowOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const activeHash = getActiveHashtagQuery(prompt, cursor);
  const filteredWorkflows = useMemo(() => {
    if (!activeHash) return [];
    return filterWorkflowMentions(workflowOptions, activeHash.query);
  }, [activeHash, workflowOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    onSendMessage(prompt, {
      workflowReferences: mentionsToWorkflowReferences(mentions),
    });
    setPrompt("");
    setMentions([]);
    setShowAssistants(false);
    setWfPickerIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (filteredWorkflows.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setWfPickerIndex((i) =>
          Math.min(i + 1, filteredWorkflows.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setWfPickerIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const opt = filteredWorkflows[wfPickerIndex];
        if (opt) {
          const next = insertWorkflowMention(prompt, cursor, opt, mentions);
          setPrompt(next.text);
          setMentions(next.mentions);
          setCursor(next.cursor);
          setWfPickerIndex(0);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setWfPickerIndex(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPrompt(value);
    setCursor(e.target.selectionStart);
    setWfPickerIndex(0);

    // @ assistants (when not in an active #workflow token)
    const hash = getActiveHashtagQuery(value, e.target.selectionStart);
    if (hash) {
      setShowAssistants(false);
      return;
    }
    const atIndex = value.lastIndexOf("@");
    if (atIndex !== -1 && atIndex >= value.length - 20) {
      const searchTerm = value.substring(atIndex + 1).toLowerCase();
      const filtered = availableAssistants.filter((assistant) =>
        assistant.name.toLowerCase().includes(searchTerm)
      );
      setShowAssistants(filtered.length > 0);
    } else {
      setShowAssistants(false);
    }
  };

  const selectAssistant = (assistant: KeywordAssistant) => {
    const atIndex = prompt.lastIndexOf("@");
    const beforeAt = prompt.substring(0, atIndex);
    setPrompt(beforeAt + `@${assistant.name} `);
    setShowAssistants(false);
    onAssistantSelect(assistant);
    textareaRef.current?.focus();
  };

  return (
    <div className="chat-interface flex h-full min-h-0 flex-col bg-gray-50 dark:bg-gray-900">
      <div className="chat-messages-scroll min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="chat-empty-state flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Bot className="h-8 w-8 text-gray-400" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-gray-700">
              How can I help you today?
            </h2>
            <p className="max-w-md text-gray-500">
              Use @ for assistants, or # to reference a workspace workflow
            </p>
          </div>
        ) : (
          <div className="chat-messages-list space-y-4 p-4">
            {messages.map((message) => (
              <ChatBubble
                key={message.id}
                message={message}
                isUser={message.isUserMessage}
              />
            ))}
            {isGenerating && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="chat-composer shrink-0 border-t bg-gray-50 p-4 dark:bg-gray-900">
        <div className="relative mx-auto max-w-4xl">
          {filteredWorkflows.length > 0 && (
            <div
              className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
              role="listbox"
              aria-label="Workflows"
            >
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase text-gray-500">
                Workflows
              </div>
              {filteredWorkflows.map((opt, i) => (
                <button
                  key={opt.workflowId}
                  type="button"
                  role="option"
                  aria-selected={i === wfPickerIndex}
                  className={cn(
                    "flex w-full px-4 py-2 text-left text-sm last:rounded-b-lg",
                    i === wfPickerIndex ? "bg-gray-100" : "hover:bg-gray-50"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const next = insertWorkflowMention(
                      prompt,
                      cursor,
                      opt,
                      mentions
                    );
                    setPrompt(next.text);
                    setMentions(next.mentions);
                    setCursor(next.cursor);
                    setWfPickerIndex(0);
                  }}
                >
                  #{opt.name}
                  <span className="ml-auto text-[10px] text-gray-400">
                    {opt.workflowId.slice(0, 8)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {showAssistants && filteredWorkflows.length === 0 && (
            <div className="chat-assistant-picker absolute bottom-full left-0 right-0 z-10 mb-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {availableAssistants
                .filter((assistant) => {
                  const atIndex = prompt.lastIndexOf("@");
                  if (atIndex === -1) return false;
                  const searchTerm = prompt.substring(atIndex + 1).toLowerCase();
                  return assistant.name.toLowerCase().includes(searchTerm);
                })
                .map((assistant) => (
                  <button
                    key={assistant.id}
                    className="flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-gray-50"
                    onClick={() => selectAssistant(assistant)}
                  >
                    <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-600" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">
                        @{assistant.name}
                      </div>
                      <div className="truncate text-sm text-gray-500">
                        {assistant.description}
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="text-purple-600">
                          {assistant.taskType}
                        </span>
                        <span className="text-gray-400">
                          · {assistant.capabilityType}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="relative">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={handlePromptChange}
              onSelect={(e) =>
                setCursor((e.target as HTMLTextAreaElement).selectionStart)
              }
              onKeyDown={handleKeyDown}
              placeholder="Message... (@ assistants, # workflows)"
              className="max-h-[200px] min-h-[52px] resize-none rounded-xl border-gray-300 pr-12 focus:border-blue-500 focus:ring-blue-500"
              disabled={isGenerating}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              className="absolute bottom-2 right-2 h-8 w-8 rounded-lg bg-blue-600 hover:bg-blue-700"
              disabled={!prompt.trim() || isGenerating}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
