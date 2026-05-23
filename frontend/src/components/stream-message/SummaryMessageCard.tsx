import React from "react";
import { ChevronDown, ChevronRight, Clock, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ClaudeStreamMessage } from "../AgentExecution";

interface CardExpansionProps {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

interface SummaryMessageCardProps {
  message: ClaudeStreamMessage;
  content: string;
  expansion: CardExpansionProps;
}

export const SummaryMessageCard: React.FC<SummaryMessageCardProps> = ({ message, content, expansion }) => {
  const lines = content.split('\n');
  const summaryContent = lines.slice(1).join('\n');
  const isExpanded = Boolean(expansion.expanded);

  return (
    <Card className="border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-lg my-4 overflow-hidden">
      <CardContent className="p-0">
        <button
          onClick={() => expansion.onExpandedChange?.(!isExpanded)}
          className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800/30 transition-colors border-b border-blue-200 dark:border-blue-700"
        >
          <div className="flex items-center gap-3">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            )}
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <div className="text-left">
              <div className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
                Context Summary - Continued
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Previous conversation ended due to context limit
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-4 h-4" />
            {message.timestamp && new Date(message.timestamp).toLocaleString()}
          </div>
        </button>

        {isExpanded && (
          <div className="p-4 bg-white dark:bg-gray-800">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded-md border border-gray-200 dark:border-gray-700 overflow-x-auto">
                {summaryContent.trim()}
              </pre>
            </div>
          </div>
        )}

        {!isExpanded && (
          <div className="px-4 pb-4 pt-2 text-sm text-gray-600 dark:text-gray-400 italic">
            Click to expand full summary of previous conversation...
          </div>
        )}
      </CardContent>
    </Card>
  );
};
