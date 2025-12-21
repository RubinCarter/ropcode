import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  User,
  FolderGit2,
  Package,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api, type ClaudeAgent, type PluginAgent } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ClaudeAgentsManagerProps {
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
  projectPath?: string;
}

const AVAILABLE_TOOLS = [
  "Task", "Read", "Edit", "Write", "MultiEdit", "TodoWrite",
  "Bash", "LS", "Glob", "Grep", "WebFetch", "WebSearch",
];

const AVAILABLE_COLORS = [
  { name: "blue", emoji: "🔵", class: "border-blue-500" },
  { name: "green", emoji: "🟢", class: "border-green-500" },
  { name: "red", emoji: "🔴", class: "border-red-500" },
  { name: "yellow", emoji: "🟡", class: "border-yellow-500" },
  { name: "purple", emoji: "🟣", class: "border-purple-500" },
  { name: "orange", emoji: "🟠", class: "border-orange-500" },
];

const AVAILABLE_MODELS = ["sonnet", "opus", "haiku", "inherit"];

export const ClaudeAgentsManager: React.FC<ClaudeAgentsManagerProps> = ({
  setToast,
  projectPath,
}) => {
  const [agents, setAgents] = useState<ClaudeAgent[]>([]);
  const [pluginAgents, setPluginAgents] = useState<PluginAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [activeScope, setActiveScope] = useState<"user" | "project" | "plugin">("user");
  const [editingAgent, setEditingAgent] = useState<ClaudeAgent | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<ClaudeAgent>>({
    name: "",
    description: "",
    tools: "",
    color: "blue",
    model: "sonnet",
    system_prompt: "",
    scope: "user",
  });

  useEffect(() => {
    loadAgents();
  }, [projectPath]);

  useEffect(() => {
    if (activeScope === "plugin" && pluginAgents.length === 0) {
      loadPluginAgents();
    }
  }, [activeScope]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const loadedAgents = await api.listClaudeConfigAgents(projectPath);
      setAgents(loadedAgents);
    } catch (error) {
      console.error("Failed to load agents:", error);
      setToast({ message: "Failed to load Claude agents", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const loadPluginAgents = async () => {
    try {
      setLoadingPlugins(true);
      const loadedPluginAgents = await api.listPluginAgents();
      setPluginAgents(loadedPluginAgents);
    } catch (error) {
      console.error("Failed to load plugin agents:", error);
      setToast({ message: "Failed to load plugin agents", type: "error" });
    } finally {
      setLoadingPlugins(false);
    }
  };

  const handleCreate = () => {
    setIsCreating(true);
    setEditingAgent(null);
    setFormData({
      name: "",
      description: "",
      tools: AVAILABLE_TOOLS.slice(0, 5).join(", "),
      color: "blue",
      model: "sonnet",
      system_prompt: "You are a helpful AI assistant.\n\n## Core Responsibilities\n- Assist with coding tasks\n- Provide clear explanations\n- Follow best practices",
      scope: activeScope,
    });
  };

  const handleEdit = (agent: ClaudeAgent) => {
    setIsCreating(false);
    setEditingAgent(agent);
    setFormData({
      ...agent,
    });
  };

  const handleSave = async () => {
    try {
      // Validate required fields
      if (!formData.name || !formData.description || !formData.system_prompt) {
        setToast({ message: "Please fill in all required fields", type: "error" });
        return;
      }

      // Validate name format
      if (!/^[a-z0-9-]+$/.test(formData.name)) {
        setToast({
          message: "Agent name must only contain lowercase letters, numbers, and hyphens",
          type: "error",
        });
        return;
      }

      setSaving(true);

      const agentToSave: ClaudeAgent = {
        name: formData.name!,
        description: formData.description!,
        tools: formData.tools || undefined,
        color: formData.color || undefined,
        model: formData.model || undefined,
        system_prompt: formData.system_prompt!,
        scope: formData.scope || "user",
        file_path: "", // Will be set by backend
      };

      await api.saveClaudeAgent(agentToSave, projectPath);

      setToast({
        message: `Agent "${formData.name}" saved successfully`,
        type: "success",
      });

      // Reset form and reload
      setIsCreating(false);
      setEditingAgent(null);
      await loadAgents();
    } catch (error: any) {
      console.error("Failed to save agent:", error);
      setToast({
        message: error?.message || "Failed to save agent",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: ClaudeAgent) => {
    if (!confirm(`Are you sure you want to delete agent "${agent.name}"?`)) {
      return;
    }

    try {
      await api.deleteClaudeAgent(agent.scope, agent.name, projectPath);
      setToast({ message: `Agent "${agent.name}" deleted`, type: "success" });
      await loadAgents();
    } catch (error: any) {
      console.error("Failed to delete agent:", error);
      setToast({
        message: error?.message || "Failed to delete agent",
        type: "error",
      });
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingAgent(null);
  };

  const filteredAgents = agents.filter((agent) => agent.scope === activeScope);

  const getColorClass = (colorName?: string) => {
    return AVAILABLE_COLORS.find((c) => c.name === colorName)?.class || "border-border";
  };

  const getColorEmoji = (colorName?: string) => {
    return AVAILABLE_COLORS.find((c) => c.name === colorName)?.emoji || "🤖";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-heading-4 mb-2">Claude Code Agents</h3>
        <p className="text-body-small text-muted-foreground">
          Manage Claude Code agents stored in{" "}
          <code className="px-1.5 py-0.5 bg-muted rounded text-xs">~/.claude/agents/</code> and{" "}
          <code className="px-1.5 py-0.5 bg-muted rounded text-xs">.claude/agents/</code>
        </p>
      </div>

      {/* Scope Tabs */}
      <Tabs value={activeScope} onValueChange={(v) => setActiveScope(v as "user" | "project" | "plugin")}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="user" className="gap-2">
              <User className="h-4 w-4" />
              User Agents
              <Badge variant="secondary" className="ml-1 text-xs">
                {agents.filter((a) => a.scope === "user").length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="project" className="gap-2" disabled={!projectPath}>
              <FolderGit2 className="h-4 w-4" />
              Project Agents
              <Badge variant="secondary" className="ml-1 text-xs">
                {agents.filter((a) => a.scope === "project").length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="plugin" className="gap-2">
              <Package className="h-4 w-4" />
              Plugin Agents
              <Badge variant="secondary" className="ml-1 text-xs">
                {pluginAgents.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {activeScope !== "plugin" && (
            <Button onClick={handleCreate} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              New Agent
            </Button>
          )}
        </div>

        {/* Content */}
        {loading || (activeScope === "plugin" && loadingPlugins) ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Agent List - User/Project */}
            {activeScope !== "plugin" && !isCreating && !editingAgent && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredAgents.length === 0 ? (
                  <Card className="col-span-full p-8 text-center text-muted-foreground">
                    <p>No {activeScope} agents found.</p>
                    <p className="text-sm mt-2">Click "New Agent" to create one.</p>
                  </Card>
                ) : (
                  filteredAgents.map((agent) => (
                    <motion.div
                      key={`${agent.scope}-${agent.name}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card
                        className={cn(
                          "p-4 border-l-4 hover:shadow-md transition-shadow cursor-pointer",
                          getColorClass(agent.color)
                        )}
                        onClick={() => handleEdit(agent)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{getColorEmoji(agent.color)}</span>
                            <div>
                              <h4 className="text-label font-semibold">{agent.name}</h4>
                              <p className="text-caption text-muted-foreground">
                                {agent.scope === "user" ? "User" : "Project"} · {agent.model || "default"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <p className="text-body-small text-muted-foreground mb-3 line-clamp-2">
                          {agent.description}
                        </p>

                        {agent.tools && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {agent.tools.split(",").slice(0, 3).map((tool, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 bg-muted rounded text-xs"
                              >
                                {tool.trim()}
                              </span>
                            ))}
                            {agent.tools.split(",").length > 3 && (
                              <span className="px-2 py-0.5 bg-muted rounded text-xs">
                                +{agent.tools.split(",").length - 3} more
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(agent);
                            }}
                            className="gap-1"
                          >
                            <Edit2 className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(agent);
                            }}
                            className="gap-1"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </Button>
                        </div>
                      </Card>
                    </motion.div>
                  ))
                )}
              </div>
            )}

            {/* Plugin Agents List */}
            {activeScope === "plugin" && !isCreating && !editingAgent && (
              <div className="space-y-4">
                {pluginAgents.length === 0 ? (
                  <Card className="p-8 text-center text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No plugin agents installed.</p>
                    <p className="text-sm mt-2">
                      Install plugins via Claude Code CLI:{" "}
                      <code className="px-1.5 py-0.5 bg-muted rounded text-xs">/plugins install [name]</code>
                    </p>
                  </Card>
                ) : (
                  <>
                    {/* Group by plugin */}
                    {Object.entries(
                      pluginAgents.reduce((acc, agent) => {
                        const key = agent.plugin_name;
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(agent);
                        return acc;
                      }, {} as Record<string, PluginAgent[]>)
                    ).map(([pluginName, agents]) => (
                      <div key={pluginName}>
                        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          {pluginName}
                          <Badge variant="secondary" className="text-xs">
                            {agents.length} agent{agents.length !== 1 ? "s" : ""}
                          </Badge>
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {agents.map((agent) => (
                            <motion.div
                              key={`${agent.plugin_id}-${agent.name}`}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -8 }}
                              transition={{ duration: 0.2 }}
                            >
                              <Card
                                className={cn(
                                  "p-4 border-l-4 border-primary/50",
                                  getColorClass(agent.color)
                                )}
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl">{getColorEmoji(agent.color)}</span>
                                    <div>
                                      <h4 className="text-label font-semibold">{agent.name}</h4>
                                      <p className="text-caption text-muted-foreground">
                                        Plugin · {agent.model || "default"}
                                      </p>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    {agent.plugin_name}
                                  </Badge>
                                </div>

                                <p className="text-body-small text-muted-foreground mb-3 line-clamp-2">
                                  {agent.description}
                                </p>

                                {agent.tools && (
                                  <div className="flex flex-wrap gap-1 mb-3">
                                    {agent.tools.split(",").slice(0, 3).map((tool, idx) => (
                                      <span
                                        key={idx}
                                        className="px-2 py-0.5 bg-muted rounded text-xs"
                                      >
                                        {tool.trim()}
                                      </span>
                                    ))}
                                    {agent.tools.split(",").length > 3 && (
                                      <span className="px-2 py-0.5 bg-muted rounded text-xs">
                                        +{agent.tools.split(",").length - 3} more
                                      </span>
                                    )}
                                  </div>
                                )}

                                <p className="text-caption text-muted-foreground">
                                  Use: <code className="px-1 py-0.5 bg-muted rounded text-xs">@{agent.plugin_name}:{agent.name}</code>
                                </p>
                              </Card>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Edit/Create Form */}
            {(isCreating || editingAgent) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-heading-4">
                      {isCreating ? "Create New Agent" : `Edit "${editingAgent?.name}"`}
                    </h4>
                    <Button variant="ghost" size="icon" onClick={handleCancel}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {/* Name */}
                    <div className="space-y-2">
                      <Label htmlFor="agent-name">
                        Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="agent-name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="code-reviewer"
                        disabled={!isCreating}
                        className="font-mono"
                      />
                      <p className="text-caption text-muted-foreground">
                        Lowercase letters, numbers, and hyphens only
                      </p>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="agent-desc">
                        Description <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="agent-desc"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Professional code review agent"
                      />
                    </div>

                    {/* Scope, Model, Color */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="agent-scope">Scope</Label>
                        <select
                          id="agent-scope"
                          value={formData.scope}
                          onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                          disabled={!isCreating}
                        >
                          <option value="user">User</option>
                          <option value="project" disabled={!projectPath}>
                            Project
                          </option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="agent-model">Model</Label>
                        <select
                          id="agent-model"
                          value={formData.model}
                          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                        >
                          {AVAILABLE_MODELS.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="agent-color">Color</Label>
                        <select
                          id="agent-color"
                          value={formData.color}
                          onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                        >
                          {AVAILABLE_COLORS.map((color) => (
                            <option key={color.name} value={color.name}>
                              {color.emoji} {color.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Tools */}
                    <div className="space-y-2">
                      <Label htmlFor="agent-tools">Tools (comma-separated)</Label>
                      <Input
                        id="agent-tools"
                        value={formData.tools}
                        onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
                        placeholder="Task, Read, Write, Bash"
                        className="font-mono text-sm"
                      />
                      <p className="text-caption text-muted-foreground">
                        Available: {AVAILABLE_TOOLS.join(", ")}
                      </p>
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-2">
                      <Label htmlFor="agent-prompt">
                        System Prompt (Markdown) <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="agent-prompt"
                        value={formData.system_prompt}
                        onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                        rows={12}
                        className="font-mono text-sm"
                        placeholder="You are a helpful AI assistant..."
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-4">
                      <Button onClick={handleSave} disabled={saving} className="gap-2">
                        {saving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            Save Agent
                          </>
                        )}
                      </Button>
                      <Button onClick={handleCancel} variant="outline">
                        Cancel
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </div>
        )}
      </Tabs>

      {/* Info Card */}
      {!isCreating && !editingAgent && (
        <Card className="p-4 bg-muted/30 border-border">
          <div className="flex gap-2">
            <AlertCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-medium">About Claude Code Agents</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                <li>• Agents are stored as Markdown files with YAML frontmatter</li>
                <li>• User agents are available across all projects</li>
                <li>• Project agents are specific to the current project</li>
                <li>• Use <code className="px-1 py-0.5 bg-background rounded">@agent-name</code> to invoke agents in Claude Code</li>
              </ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
