import React, { useState, useEffect } from "react";
import MDEditor from "@uiw/react-md-editor";
import { motion } from "framer-motion";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toast, ToastContainer } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  /**
   * Callback to go back to the main view
   */
  onBack: () => void;
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * MarkdownEditor component for editing the CLAUDE.md system prompt
 * 
 * @example
 * <MarkdownEditor onBack={() => setView('main')} />
 */
type Provider = "claude" | "codex";

const PROVIDER_INFO: Record<Provider, { name: string; file: string; path: string }> = {
  claude: {
    name: "Claude",
    file: "CLAUDE.md",
    path: "~/.claude/CLAUDE.md",
  },
  codex: {
    name: "Codex",
    file: "AGENTS.md",
    path: "~/.codex/AGENTS.md",
  },
};

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  className,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<Provider>("claude");
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const hasChanges = content !== originalContent;
  const currentProviderInfo = PROVIDER_INFO[selectedProvider];

  // Load the system prompt when provider changes
  useEffect(() => {
    loadSystemPrompt();
  }, [selectedProvider]);

  const loadSystemPrompt = async () => {
    try {
      setLoading(true);
      setError(null);
      const prompt = await api.getProviderSystemPrompt(selectedProvider);
      setContent(prompt);
      setOriginalContent(prompt);
    } catch (err) {
      console.error(`Failed to load ${selectedProvider} system prompt:`, err);
      setError(`Failed to load ${currentProviderInfo.file}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setToast(null);
      await api.saveProviderSystemPrompt(selectedProvider, content);
      setOriginalContent(content);
      setToast({ message: `${currentProviderInfo.file} saved successfully`, type: "success" });
    } catch (err) {
      console.error(`Failed to save ${selectedProvider} system prompt:`, err);
      setError(`Failed to save ${currentProviderInfo.file}`);
      setToast({ message: `Failed to save ${currentProviderInfo.file}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (newProvider: Provider) => {
    if (hasChanges) {
      const confirmSwitch = window.confirm(
        `You have unsaved changes to ${currentProviderInfo.file}. Are you sure you want to switch providers?`
      );
      if (!confirmSwitch) return;
    }
    setSelectedProvider(newProvider);
  };
  
  
  return (
    <div className={cn("h-full flex flex-col", className)}>
      <div className="max-w-6xl mx-auto flex flex-col h-full w-full">
        {/* Header */}
        <div className="p-6 space-y-6 flex-shrink-0">
          {/* Title and Save Button */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Memory</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Store and manage context for your AI workflows
              </p>
            </div>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              size="default"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </div>

          {/* Provider Tabs */}
          <div className="inline-flex items-center gap-2 bg-muted/30 p-1 rounded-lg">
            <button
              onClick={() => handleProviderChange("claude")}
              className={cn(
                "px-6 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                selectedProvider === "claude"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Claude Memory
            </button>
            <button
              onClick={() => handleProviderChange("codex")}
              className={cn(
                "px-6 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                selectedProvider === "codex"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Codex Memory
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-6 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-sm text-destructive"
          >
            {error}
          </motion.div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="h-full rounded-lg border border-border overflow-hidden" data-color-mode="dark">
              <MDEditor
                value={content}
                onChange={(val) => setContent(val || "")}
                preview="edit"
                height="100%"
                visibleDragbar={false}
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Toast Notification */}
      <ToastContainer>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastContainer>
    </div>
  );
}; 