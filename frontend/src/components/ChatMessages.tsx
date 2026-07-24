
import React from 'react';
import { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { MarkdownMessage } from '@/components/MarkdownMessage';

interface ChatMessagesProps {
  messages: ChatMessage[];
  className?: string;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({ messages, className }) => {
  // Sort messages by createdAt timestamp to ensure proper timeline order
  const sortedMessages = [...messages].sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className={cn("flex flex-col space-y-4 p-4", className)}>
      {sortedMessages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "flex w-full",
            message.isUserMessage ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              "max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm",
              message.isUserMessage
                ? "bg-blue-500 text-white rounded-br-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-md"
            )}
          >
            {message.isUserMessage ? (
              <div className="whitespace-pre-wrap break-words leading-relaxed">
                {message.content}
              </div>
            ) : (
              <MarkdownMessage
                content={message.content}
                className="leading-relaxed"
              />
            )}
            <div className={cn(
              "text-xs mt-2 opacity-70",
              message.isUserMessage ? "text-blue-100" : "text-gray-500 dark:text-gray-400"
            )}>
              {new Date(message.createdAt).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChatMessages;
