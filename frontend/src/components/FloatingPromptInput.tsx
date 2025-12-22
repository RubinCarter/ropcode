import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Maximize2,
  Minimize2,
  ChevronUp,
  Sparkles,
  Zap,
  Square,
  Brain,
  Lightbulb,
  Cpu,
  Rocket,
  Code2,

} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider, TooltipSimple, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip-modern";
import { FilePicker } from "./FilePicker";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { SkillPicker } from "./SkillPicker";
import { ImagePreview } from "./ImagePreview";
import { ProviderApiQuickSelector } from "./ProviderApiQuickSelector";
import { api, type FileEntry, type SlashCommand, type Skill } from "@/lib/api";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { OpenAIIcon } from "./icons/OpenAIIcon";
import { GeminiIcon } from "./icons/GeminiIcon";
import { EventsOn } from "../../wailsjs/runtime/runtime";

interface FloatingPromptInputProps {
  /**
   * Callback when prompt is sent
   */
  onSend: (prompt: string, model: string, providerApiId?: string | null, thinkingMode?: ThinkingMode) => void;
  /**
   * Whether the input is loading
   */
  isLoading?: boolean;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Default model to select
   */
  defaultModel?: string;
  /**
   * Default provider to select
   */
  defaultProvider?: string;
  /**
   * Callback when provider is changed
   */
  onProviderChange?: (providerId: string) => void;
  /**
   * Project path for file picker
   */
  projectPath?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when cancel is clicked (only during loading)
   */
  onCancel?: () => void;
  /**
   * Callback when /clear command is issued
   */
  onClear?: () => void;
  /**
   * Extra menu items to display in the prompt bar
   */
  extraMenuItems?: React.ReactNode;
}

export interface FloatingPromptInputRef {
  addImage: (imagePath: string) => void;
  insertText: (text: string) => void;
  setText: (text: string) => void;
  submitPrompt: () => void;
  getCurrentConfig: () => {
    model: string;
    providerApiId: string | null;
    thinkingMode: ThinkingMode;
  };
}

/**
 * Thinking mode type definition
 */
/**
 * Thinking mode types for different providers
 */
type ClaudeThinkingMode = "auto" | "think" | "think_hard" | "think_harder" | "ultrathink";
type CodexThinkingMode = "medium" | "minimal" | "low" | "high" | "xhigh";
type ThinkingMode = ClaudeThinkingMode | CodexThinkingMode;

/**
 * Thinking mode configuration
 */
type ThinkingModeConfig = {
  id: ThinkingMode;
  name: string;
  description: string;
  level: number; // 0-4 for visual indicator
  phrase?: string; // The phrase to append (for Claude)
  value?: string;  // Direct value (for Codex reasoning_effort)
  icon: React.ReactNode;
  color: string;
  shortName: string;
};

// Claude thinking modes - uses prompt engineering
const CLAUDE_THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "auto",
    name: "Auto",
    description: "Let Claude decide",
    level: 0,
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: "text-muted-foreground",
    shortName: "A"
  },
  {
    id: "think",
    name: "Think",
    description: "Basic reasoning",
    level: 1,
    phrase: "think",
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "T"
  },
  {
    id: "think_hard",
    name: "Think Hard",
    description: "Deeper analysis",
    level: 2,
    phrase: "think hard",
    icon: <Brain className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "T+"
  },
  {
    id: "think_harder",
    name: "Think Harder",
    description: "Extensive reasoning",
    level: 3,
    phrase: "think harder",
    icon: <Cpu className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "T++"
  },
  {
    id: "ultrathink",
    name: "Ultrathink",
    description: "Maximum computation",
    level: 4,
    phrase: "ultrathink",
    icon: <Rocket className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "Ultra"
  }
];

// Codex thinking modes - uses native reasoning_effort parameter
const CODEX_THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "medium",
    name: "Medium",
    description: "Default reasoning level",
    level: 0,
    value: "medium",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: "text-muted-foreground",
    shortName: "M"
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Fastest, minimal reasoning",
    level: 1,
    value: "minimal",
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    color: "text-green-500",
    shortName: "Min"
  },
  {
    id: "low",
    name: "Low",
    description: "Light reasoning",
    level: 2,
    value: "low",
    icon: <Brain className="h-3.5 w-3.5" />,
    color: "text-blue-500",
    shortName: "L"
  },
  {
    id: "high",
    name: "High",
    description: "Maximum reasoning depth",
    level: 3,
    value: "high",
    icon: <Rocket className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "H"
  }
];

// GPT-5.1 Codex Max thinking modes - different levels than standard Codex
const CODEX_MAX_THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "low",
    name: "Low",
    description: "Light reasoning",
    level: 1,
    value: "low",
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    color: "text-green-500",
    shortName: "L"
  },
  {
    id: "medium",
    name: "Medium",
    description: "Default reasoning level",
    level: 2,
    value: "medium",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: "text-muted-foreground",
    shortName: "M"
  },
  {
    id: "high",
    name: "High",
    description: "Maximizes reasoning depth",
    level: 3,
    value: "high",
    icon: <Brain className="h-3.5 w-3.5" />,
    color: "text-blue-500",
    shortName: "H"
  },
  {
    id: "xhigh",
    name: "Extra high",
    description: "Extra high reasoning depth for complex problems",
    level: 4,
    value: "xhigh",
    icon: <Rocket className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "XH"
  }
];

// Model-specific thinking modes (takes precedence over provider-level)
const MODEL_THINKING_MODES: Record<string, ThinkingModeConfig[]> = {
  "gpt-5.1-codex-max": CODEX_MAX_THINKING_MODES,
};

// Provider-specific thinking modes
const PROVIDER_THINKING_MODES: Record<string, ThinkingModeConfig[]> = {
  claude: CLAUDE_THINKING_MODES,
  codex: CODEX_THINKING_MODES,
  gemini: CLAUDE_THINKING_MODES, // Gemini uses Claude-style thinking modes (prompt engineering)
};

/**
 * ThinkingModeIndicator component - Shows visual indicator bars for thinking level
 */
const ThinkingModeIndicator: React.FC<{ level: number; color?: string }> = ({ level, color: _color }) => {
  const getBarColor = (barIndex: number) => {
    if (barIndex > level) return "bg-muted";
    return "bg-primary";
  };
  
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={cn(
            "w-1 h-3 rounded-full transition-all duration-200",
            getBarColor(i),
            i <= level && "shadow-sm"
          )}
        />
      ))}
    </div>
  );
};

type Model = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  shortName: string;
  color: string;
  provider: string; // Which provider this model belongs to
};

const CLAUDE_MODELS: Model[] = [
  {
    id: "sonnet",
    name: "Claude 4 Sonnet",
    description: "Faster, efficient for most tasks",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "S",
    color: "text-primary",
    provider: "claude"
  },
  {
    id: "sonnet[1m]",
    name: "Claude 4 Sonnet 1M",
    description: "1 million token context for large codebases",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "S1M",
    color: "text-blue-500",
    provider: "claude"
  },
  {
    id: "opus",
    name: "Claude 4 Opus",
    description: "More capable, better for complex tasks",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "O",
    color: "text-primary",
    provider: "claude"
  },
  {
    id: "haiku",
    name: "Claude 4 Haiku",
    description: "Fastest, best for simple tasks",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "H",
    color: "text-green-500",
    provider: "claude"
  }
];

const CODEX_MODELS: Model[] = [
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    description: "Maximum reasoning model with deepest analysis",
    icon: <Rocket className="h-3.5 w-3.5" />,
    shortName: "CM",
    color: "text-primary",
    provider: "codex"
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    description: "Latest coding model with enhanced reasoning",
    icon: <Code2 className="h-3.5 w-3.5" />,
    shortName: "C+",
    color: "text-primary",
    provider: "codex"
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    description: "Faster variant of GPT-5.1 Codex",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "Cm",
    color: "text-blue-500",
    provider: "codex"
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    description: "Latest general purpose model",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    shortName: "G+",
    color: "text-purple-500",
    provider: "codex"
  }
];

const GEMINI_MODELS: Model[] = [
  {
    id: "auto",
    name: "Auto",
    description: "Let the system automatically choose the best model",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    shortName: "A",
    color: "text-muted-foreground",
    provider: "gemini"
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "For complex tasks requiring deep reasoning and creativity",
    icon: <Brain className="h-3.5 w-3.5" />,
    shortName: "Pro",
    color: "text-primary",
    provider: "gemini"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "For tasks requiring a balance of speed and reasoning",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "Flash",
    color: "text-blue-500",
    provider: "gemini"
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    description: "For simple, quick tasks",
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    shortName: "Lite",
    color: "text-green-500",
    provider: "gemini"
  }
];

// Map of provider ID to their models
const PROVIDER_MODELS: Record<string, Model[]> = {
  claude: CLAUDE_MODELS,
  codex: CODEX_MODELS,
  gemini: GEMINI_MODELS,
};

type Provider = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  shortName: string;
  color: string;
};

const PROVIDERS: Provider[] = [
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic Claude AI",
    icon: <ClaudeIcon className="h-3.5 w-3.5" />,  // Claude 官方图标
    shortName: "C",
    color: "text-[#C15F3C]"  // Claude 官方颜色 (Crail 橙)
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex",
    icon: <OpenAIIcon className="h-3.5 w-3.5" />,  // OpenAI 官方图标
    shortName: "X",
    color: "text-emerald-500"  // OpenAI 品牌色系
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google Gemini",
    icon: <GeminiIcon className="h-3.5 w-3.5" />,  // Google Gemini 图标
    shortName: "G",
    color: "text-blue-500"  // Google 品牌色系
  }
];

/**
 * FloatingPromptInput component - Fixed position prompt input with model picker
 * 
 * @example
 * const promptRef = useRef<FloatingPromptInputRef>(null);
 * <FloatingPromptInput
 *   ref={promptRef}
 *   onSend={(prompt, model) => console.log('Send:', prompt, model)}
 *   isLoading={false}
 * />
 */
const FloatingPromptInputInner = (
  {
    onSend,
    isLoading = false,
    disabled = false,
    defaultModel = "sonnet",
    defaultProvider = "claude",
    onProviderChange,
    projectPath,
    className,
    onCancel,
    onClear,
    extraMenuItems,
  }: FloatingPromptInputProps,
  ref: React.Ref<FloatingPromptInputRef>,
) => {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultProvider);
  const [selectedThinkingMode, setSelectedThinkingMode] = useState<ThinkingMode>(
    defaultProvider === 'codex' ? 'medium' : 'auto' // Gemini defaults to 'auto' like Claude
  );
  const [selectedProviderApiId, setSelectedProviderApiId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingModePickerOpen, setThinkingModePickerOpen] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState("");
  const [showSlashCommandPicker, setShowSlashCommandPicker] = useState(false);
  const [slashCommandQuery, setSlashCommandQuery] = useState("");
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [embeddedImages, setEmbeddedImages] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const unlistenDragDropRef = useRef<(() => void) | null>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null); // For picker positioning via portal
  // Use 8% of viewport height as default, with min 48px and max 30vh
  const getDefaultHeight = useCallback(() => {
    const vh8 = Math.round(window.innerHeight * 0.08);
    return Math.max(48, vh8); // At least 48px
  }, []);

  const getMaxHeight = useCallback(() => {
    const vh30 = Math.round(window.innerHeight * 0.30);
    return Math.max(240, vh30); // At least 240px
  }, []);

  const [textareaHeight, setTextareaHeight] = useState<number>(getDefaultHeight);
  const isIMEComposingRef = useRef(false);

  // Calculate and set textarea height based on content
  const updateTextareaHeight = useCallback((textarea: HTMLTextAreaElement, content: string) => {
    const DEFAULT_HEIGHT = getDefaultHeight();
    const MAX_HEIGHT = getMaxHeight();

    // Reset to default height when content is empty
    if (!content.trim()) {
      setTextareaHeight(DEFAULT_HEIGHT);
      textarea.style.height = `${DEFAULT_HEIGHT}px`;
      return;
    }

    // Check if content has multiple lines (explicit newlines)
    const hasMultipleLines = content.includes('\n');

    if (!hasMultipleLines) {
      // For single-line content, check if text overflows (needs wrapping)
      // Use scrollWidth vs clientWidth comparison
      const prevHeight = textarea.style.height;
      textarea.style.height = `${DEFAULT_HEIGHT}px`;

      // If content fits in one line, keep default height
      if (textarea.scrollHeight <= DEFAULT_HEIGHT + 10) {
        setTextareaHeight(DEFAULT_HEIGHT);
        return;
      }

      // Content wraps, need to expand
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(Math.max(scrollHeight, DEFAULT_HEIGHT), MAX_HEIGHT);
      setTextareaHeight(newHeight);
      textarea.style.height = `${newHeight}px`;
      return;
    }

    // Multi-line content: measure actual height needed
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;

    // Validate scrollHeight
    if (scrollHeight > MAX_HEIGHT * 2 || scrollHeight < DEFAULT_HEIGHT / 2) {
      textarea.style.height = `${DEFAULT_HEIGHT}px`;
      setTextareaHeight(DEFAULT_HEIGHT);
      return;
    }

    const newHeight = Math.min(Math.max(scrollHeight, DEFAULT_HEIGHT), MAX_HEIGHT);
    setTextareaHeight(newHeight);
    textarea.style.height = `${newHeight}px`;
  }, [getDefaultHeight, getMaxHeight]);

  // Handle window resize to update height based on new viewport
  useEffect(() => {
    const handleResize = () => {
      // Only update if content is empty (reset to new default)
      if (!prompt.trim()) {
        setTextareaHeight(getDefaultHeight());
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [prompt, getDefaultHeight]);

  // Get current thinking modes - model-specific takes precedence over provider-level
  const currentThinkingModes = MODEL_THINKING_MODES[selectedModel] || PROVIDER_THINKING_MODES[selectedProvider] || CLAUDE_THINKING_MODES;

  // Auto-switch to provider's default model when provider changes
  useEffect(() => {
    const providerModels = PROVIDER_MODELS[selectedProvider] || CLAUDE_MODELS;
    const currentModelExists = providerModels.some(m => m.id === selectedModel);
    if (!currentModelExists) {
      // Current model doesn't exist for new provider, switch to first model
      setSelectedModel(providerModels[0].id);
    }
  }, [selectedProvider]);

  // Reset thinking mode when provider or model changes
  useEffect(() => {
    const modes = MODEL_THINKING_MODES[selectedModel] || PROVIDER_THINKING_MODES[selectedProvider] || CLAUDE_THINKING_MODES;
    const currentModeExists = modes.some(m => m.id === selectedThinkingMode);
    if (!currentModeExists) {
      // Switch to default thinking mode for new provider/model
      setSelectedThinkingMode(modes[0].id as ThinkingMode);
    }
  }, [selectedProvider, selectedModel]);

  // Expose a method to add images programmatically
  React.useImperativeHandle(
    ref,
    () => ({
      addImage: (imagePath: string) => {
        setPrompt(currentPrompt => {
          const existingPaths = extractImagePaths(currentPrompt);
          if (existingPaths.includes(imagePath)) {
            return currentPrompt; // Image already added
          }

          // Wrap path in quotes if it contains spaces
          const mention = imagePath.includes(' ') ? `@"${imagePath}"` : `@${imagePath}`;
          const newPrompt = currentPrompt + (currentPrompt.endsWith(' ') || currentPrompt === '' ? '' : ' ') + mention + ' ';

          // Focus the textarea
          setTimeout(() => {
            const target = isExpanded ? expandedTextareaRef.current : textareaRef.current;
            target?.focus();
            target?.setSelectionRange(newPrompt.length, newPrompt.length);
          }, 0);

          return newPrompt;
        });
      },
      insertText: (text: string) => {
        setPrompt(currentPrompt => {
          const newPrompt = currentPrompt + (currentPrompt.endsWith('\n') || currentPrompt === '' ? '' : '\n\n') + text;

          // Focus the textarea
          setTimeout(() => {
            const target = isExpanded ? expandedTextareaRef.current : textareaRef.current;
            target?.focus();
            target?.setSelectionRange(newPrompt.length, newPrompt.length);
          }, 0);

          return newPrompt;
        });
      },
      setText: (text: string) => {
        setPrompt(text);

        // Focus the textarea
        setTimeout(() => {
          const target = isExpanded ? expandedTextareaRef.current : textareaRef.current;
          target?.focus();
          target?.setSelectionRange(text.length, text.length);
        }, 0);
      },
      submitPrompt: () => {
        // Trigger the send action programmatically by calling handleSend directly
        handleSend();
      },
      getCurrentConfig: () => ({
        model: selectedModel,
        providerApiId: selectedProviderApiId,
        thinkingMode: selectedThinkingMode,
      }),
    }),
    [isExpanded, selectedModel, selectedProviderApiId, selectedThinkingMode]
  );

  // Helper function to check if a file is an image
  const isImageFile = (path: string): boolean => {
    // Check file extension
    const ext = path.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext || '');
  };

  // Extract image paths from prompt text
  const extractImagePaths = (text: string): string[] => {
    // console.log('[extractImagePaths] Input text length:', text.length);

    // Handle both quoted and unquoted paths
    // Pattern 1: @"path with spaces" - quoted paths
    // Pattern 2: @path - unquoted paths (continues until @ or whitespace)
    const quotedRegex = /@"([^"]+)"/g;
    const unquotedRegex = /@([^@\n\s]+)/g;

    const pathsSet = new Set<string>(); // Use Set to ensure uniqueness

    // First, extract quoted paths
    let matches = Array.from(text.matchAll(quotedRegex));
    // console.log('[extractImagePaths] Quoted matches:', matches.length);

    for (const match of matches) {
      const path = match[1]; // No need to trim, quotes preserve exact path
      // console.log('[extractImagePaths] Processing quoted path:', path);

      // Convert relative path to absolute if needed
      const fullPath = path.startsWith('/')
        ? path
        : (projectPath ? `${projectPath}/${path}` : path);

      if (isImageFile(fullPath)) {
        pathsSet.add(fullPath);
      }
    }

    // Remove quoted mentions from text to avoid double-matching
    let textWithoutQuoted = text.replace(quotedRegex, '');

    // Then extract unquoted paths
    matches = Array.from(textWithoutQuoted.matchAll(unquotedRegex));
    // console.log('[extractImagePaths] Unquoted matches:', matches.length);

    for (const match of matches) {
      const path = match[1].trim();
      // console.log('[extractImagePaths] Processing unquoted path:', path);

      // Convert relative path to absolute if needed
      const fullPath = path.startsWith('/')
        ? path
        : (projectPath ? `${projectPath}/${path}` : path);

      if (isImageFile(fullPath)) {
        pathsSet.add(fullPath);
      }
    }

    const uniquePaths = Array.from(pathsSet);
    // console.log('[extractImagePaths] Final extracted paths (unique):', uniquePaths.length);
    return uniquePaths;
  };

  // Update embedded images when prompt changes
  useEffect(() => {
    // console.log('[useEffect] Prompt changed:', prompt);
    const imagePaths = extractImagePaths(prompt);
    // console.log('[useEffect] Setting embeddedImages to:', imagePaths);
    setEmbeddedImages(imagePaths);

    // Auto-resize on prompt change (handles paste, programmatic changes, etc.)
    if (textareaRef.current && !isExpanded) {
      updateTextareaHeight(textareaRef.current, prompt);
    }
  }, [prompt, projectPath, isExpanded, updateTextareaHeight]);

  // Set up Wails drag-drop event listener
  useEffect(() => {
    // This effect runs only once on component mount to set up the listener.
    let lastDropTime = 0;

    const setupListener = () => {
      try {
        // If a listener from a previous mount/render is still around, clean it up.
        if (unlistenDragDropRef.current) {
          unlistenDragDropRef.current();
        }

        // Wails uses EventsOn for file drop events
        // The event name and structure should be defined in your Go backend
        const unlisten = EventsOn('file-drop', (data: any) => {
          if (data.type === 'enter' || data.type === 'over') {
            setDragActive(true);
          } else if (data.type === 'leave') {
            setDragActive(false);
          } else if (data.type === 'drop' && data.paths) {
            setDragActive(false);

            const currentTime = Date.now();
            if (currentTime - lastDropTime < 200) {
              // This debounce is crucial to handle the storm of drop events
              return;
            }
            lastDropTime = currentTime;

            const droppedPaths = data.paths as string[];
            const imagePaths = droppedPaths.filter(isImageFile);

            if (imagePaths.length > 0) {
              setPrompt(currentPrompt => {
                const existingPaths = extractImagePaths(currentPrompt);
                const newPaths = imagePaths.filter(p => !existingPaths.includes(p));

                if (newPaths.length === 0) {
                  return currentPrompt; // All dropped images are already in the prompt
                }

                // Wrap paths with spaces in quotes for clarity
                const mentionsToAdd = newPaths.map(p => {
                  // If path contains spaces, wrap in quotes
                  if (p.includes(' ')) {
                    return `@"${p}"`;
                  }
                  return `@${p}`;
                }).join(' ');
                const newPrompt = currentPrompt + (currentPrompt.endsWith(' ') || currentPrompt === '' ? '' : ' ') + mentionsToAdd + ' ';

                setTimeout(() => {
                  const target = isExpanded ? expandedTextareaRef.current : textareaRef.current;
                  target?.focus();
                  target?.setSelectionRange(newPrompt.length, newPrompt.length);
                }, 0);

                return newPrompt;
              });
            }
          }
        });

        unlistenDragDropRef.current = unlisten;
      } catch (error) {
        console.error('Failed to set up Wails drag-drop listener:', error);
      }
    };

    setupListener();

    return () => {
      // On unmount, ensure we clean up the listener.
      if (unlistenDragDropRef.current) {
        unlistenDragDropRef.current();
        unlistenDragDropRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount/unmount.

  useEffect(() => {
    // Focus the appropriate textarea when expanded state changes
    if (isExpanded && expandedTextareaRef.current) {
      expandedTextareaRef.current.focus();
    } else if (!isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newCursorPosition = e.target.selectionStart || 0;

    // Auto-resize textarea based on content
    if (textareaRef.current && !isExpanded) {
      updateTextareaHeight(textareaRef.current, newValue);
    }

    // Check if / was just typed at the beginning of input or after whitespace
    if (newValue.length > prompt.length && newValue[newCursorPosition - 1] === '/') {
      // Check if it's at the start or after whitespace
      const isStartOfCommand = newCursorPosition === 1 || 
        (newCursorPosition > 1 && /\s/.test(newValue[newCursorPosition - 2]));
      
      if (isStartOfCommand) {
        console.log('[FloatingPromptInput] / detected for slash command');
        setShowSlashCommandPicker(true);
        setSlashCommandQuery("");
        setCursorPosition(newCursorPosition);
      }
    }

    // Check if @ was just typed
    if (projectPath?.trim() && newValue.length > prompt.length && newValue[newCursorPosition - 1] === '@') {
      console.log('[FloatingPromptInput] @ detected, projectPath:', projectPath);
      setShowFilePicker(true);
      setFilePickerQuery("");
      setCursorPosition(newCursorPosition);
    }

    // Check if : was just typed at the beginning of input or after whitespace
    if (newValue.length > prompt.length && newValue[newCursorPosition - 1] === ':') {
      // Check if it's at the start or after whitespace
      const isStartOfSkill = newCursorPosition === 1 ||
        (newCursorPosition > 1 && /\s/.test(newValue[newCursorPosition - 2]));

      if (isStartOfSkill) {
        console.log('[FloatingPromptInput] : detected for skill picker');
        setShowSkillPicker(true);
        setSkillQuery("");
        setCursorPosition(newCursorPosition);
      }
    }

    // Check if we're typing after / (for slash command search)
    if (showSlashCommandPicker && newCursorPosition >= cursorPosition) {
      // Find the / position before cursor
      let slashPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newValue[i] === '/') {
          slashPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newValue[i] === ' ' || newValue[i] === '\n') {
          break;
        }
      }

      if (slashPosition !== -1) {
        const query = newValue.substring(slashPosition + 1, newCursorPosition);
        setSlashCommandQuery(query);
      } else {
        // / was removed or cursor moved away
        setShowSlashCommandPicker(false);
        setSlashCommandQuery("");
      }
    }

    // Check if we're typing after @ (for search query)
    if (showFilePicker && newCursorPosition >= cursorPosition) {
      // Find the @ position before cursor
      let atPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newValue[i] === '@') {
          atPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newValue[i] === ' ' || newValue[i] === '\n') {
          break;
        }
      }

      if (atPosition !== -1) {
        const query = newValue.substring(atPosition + 1, newCursorPosition);
        setFilePickerQuery(query);
      } else {
        // @ was removed or cursor moved away
        setShowFilePicker(false);
        setFilePickerQuery("");
      }
    }

    // Check if we're typing after : (for skill search)
    if (showSkillPicker && newCursorPosition >= cursorPosition) {
      // Find the : position before cursor
      let colonPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newValue[i] === ':') {
          colonPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newValue[i] === ' ' || newValue[i] === '\n') {
          break;
        }
      }

      if (colonPosition !== -1) {
        const query = newValue.substring(colonPosition + 1, newCursorPosition);
        setSkillQuery(query);
      } else {
        // : was removed or cursor moved away
        setShowSkillPicker(false);
        setSkillQuery("");
      }
    }

    setPrompt(newValue);
    setCursorPosition(newCursorPosition);
  };

  const handleFileSelect = (entry: FileEntry) => {
    if (textareaRef.current) {
      // Find the @ position before cursor
      let atPosition = -1;
      for (let i = cursorPosition - 1; i >= 0; i--) {
        if (prompt[i] === '@') {
          atPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (prompt[i] === ' ' || prompt[i] === '\n') {
          break;
        }
      }

      if (atPosition === -1) {
        // @ not found, this shouldn't happen but handle gracefully
        console.error('[FloatingPromptInput] @ position not found');
        return;
      }

      // Replace the @ and partial query with the selected entry
      const textarea = textareaRef.current;
      const beforeAt = prompt.substring(0, atPosition);
      const afterCursor = prompt.substring(cursorPosition);
      
      let reference: string;
      let cursorOffset: number;
      
      if (entry.entry_type === "agent") {
        // For agents, use @name format (Claude CLI native)
        reference = entry.name;
        cursorOffset = reference.length + 1; // +1 for @ symbol
      } else {
        // For files, use relative path as before
        const relativePath = entry.path.startsWith(projectPath || '')
          ? entry.path.slice((projectPath || '').length + 1)
          : entry.path;
        reference = relativePath;
        cursorOffset = reference.length + 1; // +1 for @ symbol
      }

      const newPrompt = `${beforeAt}@${reference} ${afterCursor}`;
      setPrompt(newPrompt);
      setShowFilePicker(false);
      setFilePickerQuery("");

      // Focus back on textarea and set cursor position after the inserted reference
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeAt.length + cursorOffset + 1; // +1 for space after reference
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleFilePickerClose = () => {
    setShowFilePicker(false);
    setFilePickerQuery("");
    // Return focus to textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleSlashCommandSelect = (command: SlashCommand) => {
    const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;
    if (!textarea) return;

    // Find the / position before cursor
    let slashPosition = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      if (prompt[i] === '/') {
        slashPosition = i;
        break;
      }
      // Stop if we hit whitespace (new word)
      if (prompt[i] === ' ' || prompt[i] === '\n') {
        break;
      }
    }

    if (slashPosition === -1) {
      console.error('[FloatingPromptInput] / position not found');
      return;
    }

    // Simply insert the command syntax
    const beforeSlash = prompt.substring(0, slashPosition);
    const afterCursor = prompt.substring(cursorPosition);
    
    if (command.accepts_arguments) {
      // Insert command with placeholder for arguments
      const newPrompt = `${beforeSlash}${command.full_command} `;
      setPrompt(newPrompt);
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");

      // Focus and position cursor after the command
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeSlash.length + command.full_command.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    } else {
      // Insert command and close picker
      const newPrompt = `${beforeSlash}${command.full_command} ${afterCursor}`;
      setPrompt(newPrompt);
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");

      // Focus and position cursor after the command
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeSlash.length + command.full_command.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleSlashCommandPickerClose = () => {
    setShowSlashCommandPicker(false);
    setSlashCommandQuery("");
    // Return focus to textarea
    setTimeout(() => {
      const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;
      textarea?.focus();
    }, 0);
  };

  const handleSkillSelect = (skill: Skill) => {
    const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;
    if (!textarea) return;

    // Find the : position before cursor
    let colonPosition = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      if (prompt[i] === ':') {
        colonPosition = i;
        break;
      }
      // Stop if we hit whitespace (new word)
      if (prompt[i] === ' ' || prompt[i] === '\n') {
        break;
      }
    }

    if (colonPosition === -1) {
      console.error('[FloatingPromptInput] : position not found');
      return;
    }

    // Insert the skill full_name (e.g., :superpowers:brainstorming)
    const beforeColon = prompt.substring(0, colonPosition);
    const afterCursor = prompt.substring(cursorPosition);
    const newPrompt = `${beforeColon}${skill.full_name} ${afterCursor}`;
    setPrompt(newPrompt);
    setShowSkillPicker(false);
    setSkillQuery("");

    // Focus and position cursor after the skill name
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = beforeColon.length + skill.full_name.length + 1;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSkillPickerClose = () => {
    setShowSkillPicker(false);
    setSkillQuery("");
    // Return focus to textarea
    setTimeout(() => {
      const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;
      textarea?.focus();
    }, 0);
  };

  const handleCompositionStart = () => {
    isIMEComposingRef.current = true;
  };

  const handleCompositionEnd = () => {
    setTimeout(() => {
      isIMEComposingRef.current = false;
    }, 0);
  };

  const isIMEInteraction = (event?: React.KeyboardEvent) => {
    if (isIMEComposingRef.current) {
      return true;
    }

    if (!event) {
      return false;
    }

    const nativeEvent = event.nativeEvent;

    if (nativeEvent.isComposing) {
      return true;
    }

    const key = nativeEvent.key;
    if (key === 'Process' || key === 'Unidentified') {
      return true;
    }

    const keyboardEvent = nativeEvent as unknown as KeyboardEvent;
    const keyCode = keyboardEvent.keyCode ?? (keyboardEvent as unknown as { which?: number }).which;
    if (keyCode === 229) {
      return true;
    }

    return false;
  };

  const handleSend = () => {
    if (isIMEInteraction()) {
      return;
    }

    // Check for /clear command
    if (prompt.trim() === '/clear') {
      onClear?.();
      setPrompt("");
      setEmbeddedImages([]);
      setTextareaHeight(getDefaultHeight());
      return;
    }

    if (prompt.trim() && !disabled) {
      let finalPrompt = prompt.trim();

      // Apply thinking mode based on provider
      const thinkingMode = currentThinkingModes.find(m => m.id === selectedThinkingMode);

      // For Claude: append thinking phrase to prompt (prompt engineering)
      if (selectedProvider === 'claude' && thinkingMode && thinkingMode.phrase) {
        finalPrompt = `${finalPrompt}.\n\n${thinkingMode.phrase}.`;
      }

      // For Codex: thinking mode is passed via reasoning_effort parameter
      // The reasoning_effort will be extracted from selectedThinkingMode in the backend

      onSend(finalPrompt, selectedModel, selectedProviderApiId, selectedThinkingMode);
      setPrompt("");
      setEmbeddedImages([]);
      setTextareaHeight(getDefaultHeight()); // Reset height after sending
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFilePicker && e.key === 'Escape') {
      e.preventDefault();
      setShowFilePicker(false);
      setFilePickerQuery("");
      return;
    }

    if (showSlashCommandPicker && e.key === 'Escape') {
      e.preventDefault();
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");
      return;
    }

    if (showSkillPicker && e.key === 'Escape') {
      e.preventDefault();
      setShowSkillPicker(false);
      setSkillQuery("");
      return;
    }

    // Add keyboard shortcut for expanding
    if (e.key === 'e' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      setIsExpanded(true);
      return;
    }

    if (
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey) &&
      !isExpanded &&
      !showFilePicker &&
      !showSlashCommandPicker &&
      !showSkillPicker
    ) {
      if (isIMEInteraction(e)) {
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();

        // Get the image blob
        const blob = item.getAsFile();
        if (!blob) continue;

        try {
          // Convert blob to base64
          const reader = new FileReader();
          reader.onload = async () => {
            const base64Data = reader.result as string;

            // Check if projectPath is available
            if (!projectPath) {
              console.error('Cannot paste image: project path not set');
              return;
            }

            try {
              // Call backend to save image and get file path
              // Pass empty string for filename to let backend auto-generate it
              const imagePath = await api.savePastedImage(base64Data, "");

              // Add file path reference (consistent with drag & drop)
              setPrompt(currentPrompt => {
                const existingPaths = extractImagePaths(currentPrompt);
                if (existingPaths.includes(imagePath)) {
                  return currentPrompt; // Image already added
                }

                // Wrap path in quotes if it contains spaces
                const mention = imagePath.includes(' ')
                  ? `@"${imagePath}"`
                  : `@${imagePath}`;
                const newPrompt = currentPrompt +
                  (currentPrompt.endsWith(' ') || currentPrompt === '' ? '' : ' ') +
                  mention + ' ';

                // Focus the textarea and move cursor to end
                setTimeout(() => {
                  const target = isExpanded ? expandedTextareaRef.current : textareaRef.current;
                  target?.focus();
                  target?.setSelectionRange(newPrompt.length, newPrompt.length);
                }, 0);

                return newPrompt;
              });
            } catch (error) {
              console.error('Failed to save pasted image:', error);
              // Optionally show error to user
            }
          };

          reader.readAsDataURL(blob);
        } catch (error) {
          console.error('Failed to paste image:', error);
        }
      }
    }
  };

  // Browser drag and drop handlers - just prevent default behavior
  // Actual file handling is done via Wails' event system
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Visual feedback is handled by Wails events
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // File processing is handled by Wails' EventsOn
  };

  const handleRemoveImage = (index: number) => {
    // Remove the corresponding @mention from the prompt
    const imagePath = embeddedImages[index];

    // Escape special regex characters
    const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedRelativePath = imagePath
      .replace(projectPath + '/', '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Create patterns for both quoted and unquoted mentions
    const patterns = [
      // Quoted full path
      new RegExp(`@"${escapedPath}"\\s?`, 'g'),
      // Unquoted full path
      new RegExp(`@${escapedPath}\\s?`, 'g'),
      // Quoted relative path
      new RegExp(`@"${escapedRelativePath}"\\s?`, 'g'),
      // Unquoted relative path
      new RegExp(`@${escapedRelativePath}\\s?`, 'g')
    ];

    let newPrompt = prompt;
    for (const pattern of patterns) {
      newPrompt = newPrompt.replace(pattern, '');
    }

    setPrompt(newPrompt.trim());
  };

  // Get models for current provider
  const currentProviderModels = PROVIDER_MODELS[selectedProvider] || CLAUDE_MODELS;
  const selectedModelData = currentProviderModels.find(m => m.id === selectedModel) || currentProviderModels[0];
  const selectedProviderData = PROVIDERS.find(p => p.id === selectedProvider) || PROVIDERS[0];

  return (
    <TooltipProvider>
    <>
      {/* Expanded Modal */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
            onClick={() => setIsExpanded(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="bg-background border border-border rounded-lg shadow-lg w-full max-w-2xl p-4 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Compose your prompt</h3>
                <TooltipSimple content="Minimize" side="bottom">
                  <motion.div
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsExpanded(false)}
                      className="h-8 w-8"
                    >
                      <Minimize2 className="h-4 w-4" />
                    </Button>
                  </motion.div>
                </TooltipSimple>
              </div>

              {/* Image previews in expanded mode */}
              {embeddedImages.length > 0 && (
                <ImagePreview
                  images={embeddedImages}
                  onRemove={handleRemoveImage}
                  className="border-t border-border pt-2"
                />
              )}

              <Textarea
                ref={expandedTextareaRef}
                value={prompt}
                onChange={handleTextChange}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onPaste={handlePaste}
                placeholder="Type your message (@ for files/agents, / for commands, : for skills)..."
                className="min-h-[200px] resize-none"
                disabled={disabled}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Model:</span>
                    <Popover
                      trigger={
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setModelPickerOpen(!modelPickerOpen)}
                          className="gap-2"
                        >
                          <span className={selectedModelData.color}>
                            {selectedModelData.icon}
                          </span>
                          {selectedModelData.name}
                        </Button>
                      }
                      content={
                        <div className="w-[300px] p-1">
                          {currentProviderModels.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => {
                                setSelectedModel(model.id);
                                setModelPickerOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                                "hover:bg-accent",
                                selectedModel === model.id && "bg-accent"
                              )}
                            >
                              <div className="mt-0.5">
                                <span className={model.color}>
                                  {model.icon}
                                </span>
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="font-medium text-sm">{model.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {model.description}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      }
                      open={modelPickerOpen}
                      onOpenChange={setModelPickerOpen}
                      align="start"
                      side="top"
                    />
                  </div>

                  {/* Thinking mode selector - available for all providers */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Thinking:</span>
                    <Popover
                      trigger={
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                                size="sm"
                                onClick={() => setThinkingModePickerOpen(!thinkingModePickerOpen)}
                                className="gap-2"
                              >
                                <span className={currentThinkingModes.find(m => m.id === selectedThinkingMode)?.color}>
                                  {currentThinkingModes.find(m => m.id === selectedThinkingMode)?.icon}
                                </span>
                                <ThinkingModeIndicator
                                  level={currentThinkingModes.find(m => m.id === selectedThinkingMode)?.level || 0}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-medium">{currentThinkingModes.find(m => m.id === selectedThinkingMode)?.name || "Auto"}</p>
                              <p className="text-xs text-muted-foreground">{currentThinkingModes.find(m => m.id === selectedThinkingMode)?.description}</p>
                            </TooltipContent>
                          </Tooltip>
                      }
                      content={
                        <div className="w-[280px] p-1">
                          {currentThinkingModes.map((mode) => (
                            <button
                              key={mode.id}
                              onClick={() => {
                                setSelectedThinkingMode(mode.id);
                                setThinkingModePickerOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                                "hover:bg-accent",
                                selectedThinkingMode === mode.id && "bg-accent"
                              )}
                            >
                              <span className={cn("mt-0.5", mode.color)}>
                                {mode.icon}
                              </span>
                              <div className="flex-1 space-y-1">
                                <div className="font-medium text-sm">
                                  {mode.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {mode.description}
                                </div>
                              </div>
                              <ThinkingModeIndicator level={mode.level} />
                            </button>
                          ))}
                        </div>
                      }
                      open={thinkingModePickerOpen}
                      onOpenChange={setThinkingModePickerOpen}
                      align="start"
                      side="top"
                    />
                  </div>
                </div>

                <TooltipSimple content="Send message" side="top">
                  <motion.div
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Button
                      onClick={handleSend}
                      disabled={!prompt.trim() || disabled}
                      size="default"
                      className="min-w-[60px]"
                    >
                      {isLoading ? (
                        <div className="rotating-symbol text-primary-foreground" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </motion.div>
                </TooltipSimple>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Bar - uses className from parent for positioning */}
      <div
        className={cn(
          "w-full bg-background/95 backdrop-blur-sm border-t border-border shadow-lg",
          dragActive && "ring-2 ring-primary ring-offset-2",
          className
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="container mx-auto">
          {/* Image previews */}
          {embeddedImages.length > 0 && (
            <ImagePreview
              images={embeddedImages}
              onRemove={handleRemoveImage}
              className="border-b border-border"
            />
          )}

          <div className="p-3">
            <div className="flex items-end gap-2">
              {/* Provider, Provider API, Model & Thinking Mode Selectors - Left side, fixed at bottom */}
              <div className="flex items-center gap-0.5 shrink-0 mb-1">
                {/* Provider Selector */}
                <Popover
                  trigger={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            className="h-9 px-1.5 hover:bg-accent/50 gap-0.5"
                          >
                            <span className={selectedProviderData.color}>
                              {selectedProviderData.icon}
                            </span>
                            <span className="text-[10px] font-bold opacity-70">
                              {selectedProviderData.shortName}
                            </span>
                            <ChevronUp className="h-3 w-3 opacity-50" />
                          </Button>
                        </motion.div>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs font-medium">{selectedProviderData.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedProviderData.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  }
                  content={
                    <div className="w-[280px] p-1">
                      {PROVIDERS.map((provider) => (
                        <button
                          key={provider.id}
                          onClick={() => {
                            setSelectedProvider(provider.id);
                            setProviderPickerOpen(false);
                            onProviderChange?.(provider.id);
                          }}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                            "hover:bg-accent",
                            selectedProvider === provider.id && "bg-accent"
                          )}
                        >
                          <div className="mt-0.5">
                            <span className={provider.color}>
                              {provider.icon}
                            </span>
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="font-medium text-sm">{provider.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {provider.description}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  }
                  open={providerPickerOpen}
                  onOpenChange={setProviderPickerOpen}
                  align="start"
                  side="top"
                />

                {/* Provider API Selector */}
                {projectPath && (
                  <ProviderApiQuickSelector
                    projectPath={projectPath}
                    providerId={selectedProvider}
                    disabled={disabled}
                    onConfigChange={(configId) => {
                      setSelectedProviderApiId(configId);
                    }}
                  />
                )}

                {/* Model Selector */}
                <Popover
                  trigger={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              className="h-9 px-1.5 hover:bg-accent/50 gap-0.5"
                            >
                              <span className={selectedModelData.color}>
                                {selectedModelData.icon}
                              </span>
                              <span className="text-[10px] font-bold opacity-70">
                                {selectedModelData.shortName}
                              </span>
                              <ChevronUp className="h-3 w-3 opacity-50" />
                            </Button>
                          </motion.div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs font-medium">{selectedModelData.name}</p>
                          <p className="text-xs text-muted-foreground">{selectedModelData.description}</p>
                        </TooltipContent>
                      </Tooltip>
                  }
                content={
                  <div className="w-[300px] p-1">
                    {currentProviderModels.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setModelPickerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                          "hover:bg-accent",
                          selectedModel === model.id && "bg-accent"
                        )}
                      >
                        <div className="mt-0.5">
                          <span className={model.color}>
                            {model.icon}
                          </span>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="font-medium text-sm">{model.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {model.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                }
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
                align="start"
                side="top"
              />

                {/* Thinking mode selector - available for all providers */}
                <Popover
                  trigger={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              className="h-9 px-1.5 hover:bg-accent/50 gap-0.5"
                            >
                              <span className={currentThinkingModes.find(m => m.id === selectedThinkingMode)?.color}>
                                {currentThinkingModes.find(m => m.id === selectedThinkingMode)?.icon}
                              </span>
                              <span className="text-[10px] font-semibold opacity-70">
                                {currentThinkingModes.find(m => m.id === selectedThinkingMode)?.shortName}
                              </span>
                              <ChevronUp className="h-3 w-3 opacity-50" />
                            </Button>
                          </motion.div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs font-medium">Thinking: {currentThinkingModes.find(m => m.id === selectedThinkingMode)?.name || "Auto"}</p>
                          <p className="text-xs text-muted-foreground">{currentThinkingModes.find(m => m.id === selectedThinkingMode)?.description}</p>
                        </TooltipContent>
                      </Tooltip>
                  }
                content={
                  <div className="w-[280px] p-1">
                    {currentThinkingModes.map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => {
                          setSelectedThinkingMode(mode.id);
                          setThinkingModePickerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                          "hover:bg-accent",
                          selectedThinkingMode === mode.id && "bg-accent"
                        )}
                      >
                        <span className={cn("mt-0.5", mode.color)}>
                          {mode.icon}
                        </span>
                        <div className="flex-1 space-y-1">
                          <div className="font-medium text-sm">
                            {mode.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {mode.description}
                          </div>
                        </div>
                        <ThinkingModeIndicator level={mode.level} />
                      </button>
                    ))}
                  </div>
                }
                open={thinkingModePickerOpen}
                onOpenChange={setThinkingModePickerOpen}
                align="start"
                side="top"
              />

              </div>

              {/* Prompt Input - Center */}
              <div className="flex-1 relative" ref={inputContainerRef}>
                <Textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onPaste={handlePaste}
                  placeholder={
                    dragActive
                      ? "Drop images here..."
                      : "Message Claude (@ for files/agents, / for commands, : for skills)..."
                  }
                  disabled={disabled}
                  className={cn(
                    "resize-none pr-20 pl-3 py-2.5 transition-all duration-150",
                    dragActive && "border-primary",
                    textareaHeight >= 240 && "overflow-y-auto scrollbar-thin"
                  )}
                  style={{
                    height: `${textareaHeight}px`,
                    overflowY: textareaHeight >= 240 ? 'auto' : 'hidden'
                  }}
                />

                {/* Action buttons inside input - fixed at bottom right */}
                <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
                  <TooltipSimple content="Expand (Ctrl+Shift+E)" side="top">
                    <motion.div
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsExpanded(true)}
                        disabled={disabled}
                        className="h-8 w-8 hover:bg-accent/50 transition-colors"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                  </TooltipSimple>

                  <TooltipSimple content={isLoading ? "Stop generation" : "Send message (⌘+Enter)"} side="top">
                    <motion.div
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Button
                        onClick={isLoading ? onCancel : handleSend}
                        disabled={isLoading ? false : (!prompt.trim() || disabled)}
                        variant={isLoading ? "destructive" : prompt.trim() ? "default" : "ghost"}
                        size="icon"
                        className={cn(
                          "h-8 w-8 transition-all",
                          prompt.trim() && !isLoading && "shadow-sm"
                        )}
                      >
                        {isLoading ? (
                          <Square className="h-4 w-4" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </motion.div>
                  </TooltipSimple>
                </div>

                {/* File Picker */}
                <AnimatePresence>
                  {showFilePicker && projectPath && projectPath.trim() && (
                    <FilePicker
                      basePath={projectPath.trim()}
                      onSelect={handleFileSelect}
                      onClose={handleFilePickerClose}
                      initialQuery={filePickerQuery}
                      showAgents={true}
                      anchorRef={inputContainerRef}
                    />
                  )}
                </AnimatePresence>

                {/* Slash Command Picker */}
                <AnimatePresence>
                  {showSlashCommandPicker && (
                    <SlashCommandPicker
                      projectPath={projectPath}
                      onSelect={handleSlashCommandSelect}
                      onClose={handleSlashCommandPickerClose}
                      initialQuery={slashCommandQuery}
                      provider={selectedProvider as 'claude' | 'codex' | 'gemini'}
                      anchorRef={inputContainerRef}
                    />
                  )}
                </AnimatePresence>

                {/* Skill Picker */}
                <AnimatePresence>
                  {showSkillPicker && (
                    <SkillPicker
                      projectPath={projectPath}
                      onSelect={handleSkillSelect}
                      onClose={handleSkillPickerClose}
                      initialQuery={skillQuery}
                      anchorRef={inputContainerRef}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Extra menu items - Right side, fixed at bottom */}
              {extraMenuItems && (
                <div className="flex items-center gap-0.5 shrink-0 mb-1">
                  {extraMenuItems}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
    </TooltipProvider>
  );
};

export const FloatingPromptInput = React.forwardRef<
  FloatingPromptInputRef,
  FloatingPromptInputProps
>(FloatingPromptInputInner);

FloatingPromptInput.displayName = 'FloatingPromptInput';
