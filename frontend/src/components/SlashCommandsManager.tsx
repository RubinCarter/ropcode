import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Edit,
  Save,
  Command,
  Globe,
  FolderOpen,
  Terminal,
  FileCode,
  Zap,
  Code,
  AlertCircle,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type SlashCommand, type CommandType } from "@/lib/api";
import { cn } from "@/lib/utils";
import { COMMON_TOOL_MATCHERS } from "@/types/hooks";
import { useTrackEvent } from "@/hooks";

interface SlashCommandsManagerProps {
  projectPath?: string;
  className?: string;
  scopeFilter?: 'project' | 'user' | 'all';
}

interface CommandForm {
  name: string;
  namespace: string;
  content: string;
  description: string;
  allowedTools: string[];
  argumentHint: string;
  scope: 'project' | 'user';
  commandType: CommandType;
}

const CLAUDE_EXAMPLES = [
  {
    name: "review",
    description: "Review code for best practices",
    content: "Review the following code for best practices, potential issues, and improvements:\n\n@$ARGUMENTS",
    allowedTools: ["Read", "Grep"]
  },
  {
    name: "explain",
    description: "Explain how something works",
    content: "Explain how $ARGUMENTS works in detail, including its purpose, implementation, and usage examples.",
    allowedTools: ["Read", "Grep", "WebSearch"]
  },
  {
    name: "fix-issue",
    description: "Fix a specific issue",
    content: "Fix issue #$ARGUMENTS following our coding standards and best practices.",
    allowedTools: ["Read", "Edit", "MultiEdit", "Write"]
  },
  {
    name: "test",
    description: "Write tests for code",
    content: "Write comprehensive tests for:\n\n@$ARGUMENTS\n\nInclude unit tests, edge cases, and integration tests where appropriate.",
    allowedTools: ["Read", "Write", "Edit"]
  }
];

const CODEX_EXAMPLES = [
  {
    name: "review",
    description: "Request a concise git diff review",
    content: "Review the git diff for $FILE focusing on $FOCUS.\n\nProvide:\n- Code quality assessment\n- Potential bugs\n- Best practice violations",
    argumentHint: "FILE=<path> [FOCUS=<section>]"
  },
  {
    name: "test",
    description: "Generate comprehensive test coverage",
    content: "Generate comprehensive tests for $FILE focusing on $TYPE testing.\n\nInclude:\n- Edge cases\n- Error handling\n- Mock setup\n$ARGUMENTS",
    argumentHint: "FILE=<path> [TYPE=unit|integration]"
  },
  {
    name: "docs",
    description: "Generate documentation",
    content: "Generate documentation for $MODULE.\n\nInclude:\n- API reference\n- Usage examples\n- Common patterns\n$ARGUMENTS",
    argumentHint: "MODULE=<name>"
  },
  {
    name: "refactor",
    description: "Refactor code for better maintainability",
    content: "Refactor $FILE to improve $ASPECT.\n\nFocus on:\n- Code clarity\n- Performance\n- Best practices\n$ARGUMENTS",
    argumentHint: "FILE=<path> ASPECT=<readability|performance|structure>"
  }
];

// Get icon for command based on its properties
const getCommandIcon = (command: SlashCommand) => {
  if (command.has_bash_commands) return Terminal;
  if (command.has_file_references) return FileCode;
  if (command.accepts_arguments) return Zap;
  if (command.scope === "project") return FolderOpen;
  if (command.scope === "user") return Globe;
  return Command;
};

/**
 * SlashCommandsManager component for managing custom slash commands
 * Provides a no-code interface for creating, editing, and deleting commands
 */
export const SlashCommandsManager: React.FC<SlashCommandsManagerProps> = ({
  projectPath,
  className,
  scopeFilter = 'all',
}) => {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedScope, setSelectedScope] = useState<'all' | 'project' | 'user' | 'plugin' | 'default'>(scopeFilter === 'all' ? 'all' : scopeFilter as 'project' | 'user');
  const [selectedCommandType, setSelectedCommandType] = useState<CommandType>('claude');
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(new Set());
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<SlashCommand | null>(null);
  const [commandForm, setCommandForm] = useState<CommandForm>({
    name: "",
    namespace: "",
    content: "",
    description: "",
    allowedTools: [],
    argumentHint: "",
    scope: 'user',
    commandType: 'claude'
  });

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [commandToDelete, setCommandToDelete] = useState<SlashCommand | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Convert dialog state
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [commandToConvert, setCommandToConvert] = useState<SlashCommand | null>(null);
  const [converting, setConverting] = useState(false);
  
  // Analytics tracking
  const trackEvent = useTrackEvent();

  // Load commands on mount
  useEffect(() => {
    loadCommands();
  }, [projectPath]);

  const loadCommands = async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedCommands = await api.slashCommandsList(projectPath);
      setCommands(loadedCommands);
    } catch (err) {
      console.error("Failed to load slash commands:", err);
      setError("Failed to load commands");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setEditingCommand(null);
    setCommandForm({
      name: "",
      namespace: "",
      content: "",
      description: "",
      allowedTools: [],
      argumentHint: "",
      scope: scopeFilter !== 'all' ? scopeFilter : (projectPath ? 'project' : 'user'),
      commandType: selectedCommandType
    });
    setEditDialogOpen(true);
  };

  const handleEdit = (command: SlashCommand) => {
    setEditingCommand(command);
    setCommandForm({
      name: command.name,
      namespace: command.namespace || "",
      content: command.content,
      description: command.description || "",
      allowedTools: command.allowed_tools || [],
      argumentHint: command.argument_hint || "",
      scope: command.scope as 'project' | 'user',
      commandType: command.command_type
    });
    setEditDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      await api.slashCommandSave(
        commandForm.name,
        commandForm.content,
        commandForm.scope,
        commandForm.scope === 'project' ? projectPath : undefined
      );
      
      // Track command creation
      trackEvent.slashCommandCreated({
        command_type: editingCommand ? 'custom' : 'custom',
        has_parameters: commandForm.content.includes('$ARGUMENTS')
      });

      setEditDialogOpen(false);
      await loadCommands();
    } catch (err) {
      console.error("Failed to save command:", err);
      setError(err instanceof Error ? err.message : "Failed to save command");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (command: SlashCommand) => {
    setCommandToDelete(command);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!commandToDelete) return;

    try {
      setDeleting(true);
      setError(null);
      await api.slashCommandDelete(commandToDelete.id, projectPath);
      setDeleteDialogOpen(false);
      setCommandToDelete(null);
      await loadCommands();
    } catch (err) {
      console.error("Failed to delete command:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to delete command";
      setError(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setCommandToDelete(null);
  };

  const handleConvertClick = (command: SlashCommand) => {
    setCommandToConvert(command);
    setConvertDialogOpen(true);
  };

  const confirmConvert = async () => {
    if (!commandToConvert) return;

    try {
      setConverting(true);
      setError(null);

      const targetType: CommandType = commandToConvert.command_type === 'claude' ? 'codex' : 'claude';

      // Convert fields based on target type
      let convertedAllowedTools: string[] = [];
      let convertedArgumentHint: string | undefined = undefined;

      if (targetType === 'codex') {
        // Claude -> Codex: Convert allowed_tools to argument_hint suggestion
        if (commandToConvert.allowed_tools && commandToConvert.allowed_tools.length > 0) {
          convertedArgumentHint = `[Tools: ${commandToConvert.allowed_tools.join(', ')}]`;
        }
      } else {
        // Codex -> Claude: Keep allowed_tools empty, user can add later
        convertedAllowedTools = [];
      }

      // Save as new command type
      await api.slashCommandSave(
        commandToConvert.name,
        commandToConvert.content,
        commandToConvert.scope as 'project' | 'user',
        commandToConvert.scope === 'project' ? projectPath : undefined
      );

      setConvertDialogOpen(false);
      setCommandToConvert(null);
      await loadCommands();
    } catch (err) {
      console.error("Failed to convert command:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to convert command";
      setError(errorMessage);
    } finally {
      setConverting(false);
    }
  };

  const cancelConvert = () => {
    setConvertDialogOpen(false);
    setCommandToConvert(null);
  };

  const toggleExpanded = (commandId: string) => {
    setExpandedCommands(prev => {
      const next = new Set(prev);
      if (next.has(commandId)) {
        next.delete(commandId);
      } else {
        next.add(commandId);
      }
      return next;
    });
  };

  const handleToolToggle = (tool: string) => {
    setCommandForm(prev => ({
      ...prev,
      allowedTools: prev.allowedTools.includes(tool)
        ? prev.allowedTools.filter(t => t !== tool)
        : [...prev.allowedTools, tool]
    }));
  };

  const applyExample = (example: typeof CLAUDE_EXAMPLES[0] | typeof CODEX_EXAMPLES[0]) => {
    if (commandForm.commandType === 'claude' && 'allowedTools' in example) {
      setCommandForm(prev => ({
        ...prev,
        name: example.name,
        description: example.description,
        content: example.content,
        allowedTools: example.allowedTools
      }));
    } else if (commandForm.commandType === 'codex' && 'argumentHint' in example) {
      setCommandForm(prev => ({
        ...prev,
        name: example.name,
        description: example.description,
        content: example.content,
        argumentHint: example.argumentHint
      }));
    }
  };

  // Check if a command has already been converted
  const isAlreadyConverted = (command: SlashCommand): boolean => {
    const targetType: CommandType = command.command_type === 'claude' ? 'codex' : 'claude';

    return commands.some(cmd =>
      cmd.command_type === targetType &&
      cmd.name === command.name &&
      cmd.namespace === command.namespace &&
      cmd.scope === command.scope
    );
  };

  // Filter commands
  const filteredCommands = commands.filter(cmd => {
    // Hide default commands (unless explicitly viewing them)
    if (cmd.scope === 'default' && selectedScope !== 'default') {
      return false;
    }

    // Filter by command type
    if (cmd.command_type !== selectedCommandType) {
      return false;
    }

    // Apply scopeFilter if set to specific scope
    if (scopeFilter !== 'all' && cmd.scope !== scopeFilter) {
      return false;
    }

    // Scope filter - handle 'plugin' scope
    if (selectedScope !== 'all') {
      if (selectedScope === 'plugin' && cmd.scope !== 'plugin') return false;
      if (selectedScope === 'default' && cmd.scope !== 'default') return false;
      if (selectedScope !== 'plugin' && selectedScope !== 'default' && cmd.scope !== selectedScope) return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        cmd.name.toLowerCase().includes(query) ||
        cmd.full_command.toLowerCase().includes(query) ||
        (cmd.description && cmd.description.toLowerCase().includes(query)) ||
        (cmd.namespace && cmd.namespace.toLowerCase().includes(query)) ||
        (cmd.plugin_name && cmd.plugin_name.toLowerCase().includes(query))
      );
    }

    return true;
  });

  // Group commands by namespace and scope
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    let key: string;
    if (cmd.scope === 'plugin' && cmd.plugin_name) {
      key = `Plugin: ${cmd.plugin_name}`;
    } else if (cmd.scope === 'default') {
      key = 'Built-in Commands';
    } else if (cmd.namespace) {
      key = `${cmd.namespace} (${cmd.scope})`;
    } else {
      key = `${cmd.scope === 'project' ? 'Project' : 'User'} Commands`;
    }
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(cmd);
    return acc;
  }, {} as Record<string, SlashCommand[]>);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {scopeFilter === 'project' ? 'Project Slash Commands' : 'Slash Commands'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {scopeFilter === 'project'
              ? 'Create custom commands for this project'
              : 'Create custom commands to streamline your workflow'}
          </p>
        </div>
        <Button onClick={handleCreateNew} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Command
        </Button>
      </div>

      {/* Command Type Tabs */}
      <Tabs value={selectedCommandType} onValueChange={(value) => setSelectedCommandType(value as CommandType)}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="claude">Claude Commands</TabsTrigger>
          <TabsTrigger value="codex">Codex Commands</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        {scopeFilter === 'all' && (
          <Select value={selectedScope} onValueChange={(value: any) => setSelectedScope(value)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Commands</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="plugin">Plugin</SelectItem>
              <SelectItem value="default">Built-in</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Commands List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredCommands.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <Command className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? "No commands found"
                : scopeFilter === 'project'
                  ? `No ${selectedCommandType === 'claude' ? 'Claude' : 'Codex'} project commands created yet`
                  : `No ${selectedCommandType === 'claude' ? 'Claude' : 'Codex'} commands created yet`}
            </p>
            {!searchQuery && (
              <Button onClick={handleCreateNew} variant="outline" size="sm" className="mt-4">
                {scopeFilter === 'project'
                  ? `Create your first ${selectedCommandType === 'claude' ? 'Claude' : 'Codex'} project command`
                  : `Create your first ${selectedCommandType === 'claude' ? 'Claude' : 'Codex'} command`}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedCommands).map(([groupKey, groupCommands]) => (
            <Card key={groupKey} className="overflow-hidden">
              <div className="p-4 bg-muted/50 border-b">
                <h4 className="text-sm font-medium">
                  {groupKey}
                </h4>
              </div>
              
              <div className="divide-y">
                {groupCommands.map((command) => {
                  const Icon = getCommandIcon(command);
                  const isExpanded = expandedCommands.has(command.id);
                  
                  return (
                    <div key={command.id}>
                      <div className="p-4">
                        <div className="flex items-start gap-4">
                          <Icon className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <code className="text-sm font-mono text-primary">
                                {command.full_command}
                              </code>
                              {command.accepts_arguments && (
                                <Badge variant="secondary" className="text-xs">
                                  Arguments
                                </Badge>
                              )}
                            </div>
                            
                            {command.description && (
                              <p className="text-sm text-muted-foreground mb-2">
                                {command.description}
                              </p>
                            )}
                            
                            <div className="flex items-center gap-4 text-xs">
                              {command.allowed_tools && command.allowed_tools.length > 0 && (
                                <span className="text-muted-foreground">
                                  {command.allowed_tools.length} tool{command.allowed_tools.length === 1 ? '' : 's'}
                                </span>
                              )}
                              
                              {command.has_bash_commands && (
                                <Badge variant="outline" className="text-xs">
                                  Bash
                                </Badge>
                              )}
                              
                              {command.has_file_references && (
                                <Badge variant="outline" className="text-xs">
                                  Files
                                </Badge>
                              )}
                              
                              <button
                                onClick={() => toggleExpanded(command.id)}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronDown className="h-3 w-3" />
                                    Hide content
                                  </>
                                ) : (
                                  <>
                                    <ChevronRight className="h-3 w-3" />
                                    Show content
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {/* Show plugin badge for plugin commands */}
                            {command.scope === 'plugin' && command.plugin_name && (
                              <Badge variant="outline" className="text-xs">
                                {command.plugin_name}
                              </Badge>
                            )}
                            {/* Only show edit/delete for user/project commands */}
                            {command.scope !== 'plugin' && command.scope !== 'default' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEdit(command)}
                                  className="h-8 w-8"
                                  title="Edit command"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                {!isAlreadyConverted(command) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleConvertClick(command)}
                                    className="h-8 w-8"
                                    title={`Convert to ${command.command_type === 'claude' ? 'Codex' : 'Claude'}`}
                                  >
                                    <ArrowRightLeft className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteClick(command)}
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  title="Delete command"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 p-3 bg-muted/50 rounded-md">
                                <pre className="text-xs font-mono whitespace-pre-wrap">
                                  {command.content}
                                </pre>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCommand ? "Edit Command" : "Create New Command"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Command Type */}
            <div className="space-y-2">
              <Label>Command Type</Label>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <Badge variant={commandForm.commandType === 'claude' ? 'default' : 'secondary'}>
                  {commandForm.commandType === 'claude' ? 'Claude' : 'Codex'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {commandForm.commandType === 'claude'
                    ? 'Stored in .claude/commands'
                    : 'Stored in .codex/prompts'}
                </span>
              </div>
            </div>

            {/* Scope */}
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={commandForm.scope}
                onValueChange={(value: 'project' | 'user') => setCommandForm(prev => ({ ...prev, scope: value }))}
                disabled={scopeFilter !== 'all' || (!projectPath && commandForm.scope === 'project')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(scopeFilter === 'all' || scopeFilter === 'user') && (
                    <SelectItem value="user">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        User (Global)
                      </div>
                    </SelectItem>
                  )}
                  {(scopeFilter === 'all' || scopeFilter === 'project') && (
                    <SelectItem value="project" disabled={!projectPath}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        Project
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {commandForm.scope === 'user'
                  ? "Available across all projects"
                  : "Only available in this project"}
              </p>
            </div>

            {/* Name and Namespace */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Command Name*</Label>
                <Input
                  placeholder="e.g., review, fix-issue"
                  value={commandForm.name}
                  onChange={(e) => setCommandForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Namespace (Optional)</Label>
                <Input
                  placeholder="e.g., frontend, backend"
                  value={commandForm.namespace}
                  onChange={(e) => setCommandForm(prev => ({ ...prev, namespace: e.target.value }))}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                placeholder="Brief description of what this command does"
                value={commandForm.description}
                onChange={(e) => setCommandForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label>Command Content*</Label>
              <Textarea
                placeholder="Enter the prompt content. Use $ARGUMENTS for dynamic values."
                value={commandForm.content}
                onChange={(e) => setCommandForm(prev => ({ ...prev, content: e.target.value }))}
                className="min-h-[150px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use <code>$ARGUMENTS</code> for user input, <code>@filename</code> for files, 
                and <code>!`command`</code> for bash commands
              </p>
            </div>

            {/* Type-specific fields */}
            {commandForm.commandType === 'claude' ? (
              /* Claude: Allowed Tools */
              <div className="space-y-2">
                <Label>Allowed Tools</Label>
                <div className="flex flex-wrap gap-2">
                  {COMMON_TOOL_MATCHERS.map((tool) => (
                    <Button
                      key={tool}
                      variant={commandForm.allowedTools.includes(tool) ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleToolToggle(tool)}
                      type="button"
                    >
                      {tool}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Select which tools Claude can use with this command
                </p>
              </div>
            ) : (
              /* Codex: Argument Hint */
              <div className="space-y-2">
                <Label>Argument Hint (Optional)</Label>
                <Input
                  placeholder="e.g., FILE=<path> [TYPE=unit|integration]"
                  value={commandForm.argumentHint}
                  onChange={(e) => setCommandForm(prev => ({ ...prev, argumentHint: e.target.value }))}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Document expected inputs using KEY=value syntax (e.g., <code>FILE=&lt;path&gt;</code>)
                </p>
              </div>
            )}

            {/* Examples */}
            {!editingCommand && (
              <div className="space-y-2">
                <Label>Examples</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(commandForm.commandType === 'claude' ? CLAUDE_EXAMPLES : CODEX_EXAMPLES).map((example) => (
                    <Button
                      key={example.name}
                      variant="outline"
                      size="sm"
                      onClick={() => applyExample(example)}
                      className="justify-start"
                    >
                      <Code className="h-4 w-4 mr-2" />
                      {example.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            {commandForm.name && (
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="p-3 bg-muted rounded-md">
                  <code className="text-sm">
                    /
                    {commandForm.namespace && `${commandForm.namespace}:`}
                    {commandForm.name}
                    {commandForm.content.includes('$ARGUMENTS') && ' [arguments]'}
                  </code>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!commandForm.name || !commandForm.content || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Command</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p>Are you sure you want to delete this command?</p>
            {commandToDelete && (
              <div className="p-3 bg-muted rounded-md">
                <code className="text-sm font-mono">{commandToDelete.full_command}</code>
                {commandToDelete.description && (
                  <p className="text-sm text-muted-foreground mt-1">{commandToDelete.description}</p>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              This action cannot be undone. The command file will be permanently deleted.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Confirmation Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert Command</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {commandToConvert && (
              <>
                <p>Convert this command to {commandToConvert.command_type === 'claude' ? 'Codex' : 'Claude'} format?</p>

                <div className="p-3 bg-muted rounded-md space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={commandToConvert.command_type === 'claude' ? 'default' : 'secondary'}>
                      {commandToConvert.command_type === 'claude' ? 'Claude' : 'Codex'}
                    </Badge>
                    <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                    <Badge variant={commandToConvert.command_type === 'claude' ? 'secondary' : 'default'}>
                      {commandToConvert.command_type === 'claude' ? 'Codex' : 'Claude'}
                    </Badge>
                  </div>
                  <code className="text-sm font-mono block">{commandToConvert.full_command}</code>
                  {commandToConvert.description && (
                    <p className="text-sm text-muted-foreground">{commandToConvert.description}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Conversion details:</p>
                  {commandToConvert.command_type === 'claude' ? (
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                      <li>Will be saved to <code className="text-xs">.codex/prompts</code></li>
                      <li>Allowed tools will be converted to argument hint</li>
                      <li>Command content will be preserved</li>
                    </ul>
                  ) : (
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                      <li>Will be saved to <code className="text-xs">.claude/commands</code></li>
                      <li>Argument hint will be removed (Claude doesn't support it)</li>
                      <li>Command content will be preserved</li>
                      <li>You can add allowed tools after conversion</li>
                    </ul>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  The original command will remain unchanged. A new command file will be created.
                </p>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={cancelConvert} disabled={converting}>
              Cancel
            </Button>
            <Button
              onClick={confirmConvert}
              disabled={converting}
            >
              {converting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Converting...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  Convert
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}; 
