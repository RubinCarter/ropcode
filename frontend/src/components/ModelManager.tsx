import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Star,
  StarOff,
  Eye,
  EyeOff,
  Brain,
  ChevronDown,
  ChevronUp,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type ModelConfig, type ThinkingLevel } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ModelManagerProps {
  setToast?: (toast: { message: string; type: "success" | "error" } | null) => void;
}

interface EditingModel {
  model_id: string;
  provider_id: string;
  display_name: string;
  description: string;
  thinking_levels: ThinkingLevel[];
}

const PROVIDERS = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex (OpenAI)" },
  { id: "gemini", name: "Gemini" },
];

export const ModelManager: React.FC<ModelManagerProps> = ({ setToast }) => {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProvider, setExpandedProvider] = useState<string | null>("claude");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newModel, setNewModel] = useState<EditingModel>({
    model_id: "",
    provider_id: "claude",
    display_name: "",
    description: "",
    thinking_levels: [],
  });

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      const configs = await api.getAllModelConfigs();
      setModels(configs || []);
    } catch (err) {
      console.error("Failed to load models:", err);
      setToast?.({ message: "Failed to load models", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newModel.model_id || !newModel.display_name) {
      setToast?.({ message: "Model ID and Display Name are required", type: "error" });
      return;
    }

    try {
      await api.createModelConfig({
        model_id: newModel.model_id,
        provider_id: newModel.provider_id,
        display_name: newModel.display_name,
        description: newModel.description,
        thinking_levels: newModel.thinking_levels,
      });
      setToast?.({ message: "Model created successfully", type: "success" });
      setIsCreating(false);
      setNewModel({
        model_id: "",
        provider_id: "claude",
        display_name: "",
        description: "",
        thinking_levels: [],
      });
      loadModels();
    } catch (err) {
      console.error("Failed to create model:", err);
      setToast?.({ message: "Failed to create model", type: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteModelConfig(id);
      setToast?.({ message: "Model deleted", type: "success" });
      loadModels();
    } catch (err) {
      console.error("Failed to delete model:", err);
      setToast?.({ message: "Failed to delete model", type: "error" });
    }
  };

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    try {
      await api.setModelConfigEnabled(id, !currentEnabled);
      loadModels();
    } catch (err) {
      console.error("Failed to toggle model:", err);
      setToast?.({ message: "Failed to update model", type: "error" });
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setModelConfigDefault(id);
      setToast?.({ message: "Default model updated", type: "success" });
      loadModels();
    } catch (err) {
      console.error("Failed to set default:", err);
      setToast?.({ message: "Failed to set default model", type: "error" });
    }
  };

  const getModelsByProvider = (providerID: string) => {
    return models.filter((m) => m.provider_id === providerID);
  };

  const addThinkingLevel = () => {
    setNewModel((prev) => ({
      ...prev,
      thinking_levels: [
        ...prev.thinking_levels,
        { id: "", name: "", budget: 10000, is_default: prev.thinking_levels.length === 0 },
      ],
    }));
  };

  const updateThinkingLevel = (index: number, field: keyof ThinkingLevel, value: any) => {
    setNewModel((prev) => ({
      ...prev,
      thinking_levels: prev.thinking_levels.map((level, i) => {
        if (i === index) {
          return { ...level, [field]: value };
        }
        // If setting this as default, unset others
        if (field === "is_default" && value === true && i !== index) {
          return { ...level, is_default: false };
        }
        return level;
      }),
    }));
  };

  const removeThinkingLevel = (index: number) => {
    setNewModel((prev) => ({
      ...prev,
      thinking_levels: prev.thinking_levels.filter((_, i) => i !== index),
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-heading-4">Models</h3>
          <p className="text-body-small text-muted-foreground mt-1">
            Configure AI models and their thinking levels
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCreating(true)}
          disabled={isCreating}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Model
        </Button>
      </div>

      {/* Create New Model Form */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="p-4 space-y-4 border-primary/50">
              <div className="flex items-center justify-between">
                <h4 className="text-label font-medium">New Model</h4>
                <Button variant="ghost" size="icon" onClick={() => setIsCreating(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select
                    value={newModel.provider_id}
                    onValueChange={(v) => setNewModel((p) => ({ ...p, provider_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Model ID</Label>
                  <Input
                    placeholder="e.g., claude-sonnet-5"
                    value={newModel.model_id}
                    onChange={(e) => setNewModel((p) => ({ ...p, model_id: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    placeholder="e.g., Claude Sonnet 5"
                    value={newModel.display_name}
                    onChange={(e) => setNewModel((p) => ({ ...p, display_name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    placeholder="Optional description"
                    value={newModel.description}
                    onChange={(e) => setNewModel((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
              </div>

              {/* Thinking Levels */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    Thinking Levels
                  </Label>
                  <Button variant="ghost" size="sm" onClick={addThinkingLevel}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Level
                  </Button>
                </div>

                {newModel.thinking_levels.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    No thinking levels - model will not support extended thinking
                  </p>
                ) : (
                  <div className="space-y-2">
                    {newModel.thinking_levels.map((level, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                        <Input
                          placeholder="ID"
                          value={level.id}
                          onChange={(e) => updateThinkingLevel(idx, "id", e.target.value)}
                          className="w-24"
                        />
                        <Input
                          placeholder="Name"
                          value={level.name}
                          onChange={(e) => updateThinkingLevel(idx, "name", e.target.value)}
                          className="w-28"
                        />
                        <Input
                          placeholder="Budget"
                          value={level.budget}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateThinkingLevel(
                              idx,
                              "budget",
                              val === "auto" ? "auto" : parseInt(val) || 0
                            );
                          }}
                          className="w-24"
                        />
                        <button
                          onClick={() => updateThinkingLevel(idx, "is_default", true)}
                          className={cn(
                            "p-1 rounded",
                            level.is_default
                              ? "text-amber-500"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          title="Set as default"
                        >
                          {level.is_default ? (
                            <Star className="h-4 w-4 fill-current" />
                          ) : (
                            <StarOff className="h-4 w-4" />
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeThinkingLevel(idx)}
                          className="h-8 w-8"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate}>Create Model</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Provider Sections */}
      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const providerModels = getModelsByProvider(provider.id);
          const isExpanded = expandedProvider === provider.id;

          return (
            <Card key={provider.id} className="overflow-hidden">
              <button
                onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{provider.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {providerModels.length} model{providerModels.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t">
                      {providerModels.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground">
                          No models configured for this provider
                        </p>
                      ) : (
                        <div className="divide-y">
                          {providerModels.map((model) => (
                            <div
                              key={model.id}
                              className="p-4 flex items-center justify-between hover:bg-muted/20"
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{model.display_name}</span>
                                  {model.is_builtin && (
                                    <Lock className="h-3 w-3 text-muted-foreground" title="Built-in" />
                                  )}
                                  {model.is_default && (
                                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                                      Default
                                    </span>
                                  )}
                                  {!model.is_enabled && (
                                    <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                      Disabled
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <code className="text-xs text-muted-foreground bg-muted px-1 rounded">
                                    {model.model_id}
                                  </code>
                                  {model.thinking_levels?.length > 0 && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Brain className="h-3 w-3" />
                                      {model.thinking_levels.length} levels
                                    </span>
                                  )}
                                </div>
                                {model.description && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {model.description}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Enable/Disable */}
                                <button
                                  onClick={() => handleToggleEnabled(model.id, model.is_enabled)}
                                  className={cn(
                                    "p-1.5 rounded hover:bg-muted",
                                    model.is_enabled
                                      ? "text-foreground"
                                      : "text-muted-foreground"
                                  )}
                                  title={model.is_enabled ? "Disable" : "Enable"}
                                >
                                  {model.is_enabled ? (
                                    <Eye className="h-4 w-4" />
                                  ) : (
                                    <EyeOff className="h-4 w-4" />
                                  )}
                                </button>

                                {/* Set Default */}
                                {!model.is_default && model.is_enabled && (
                                  <button
                                    onClick={() => handleSetDefault(model.id)}
                                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-amber-500"
                                    title="Set as default"
                                  >
                                    <StarOff className="h-4 w-4" />
                                  </button>
                                )}
                                {model.is_default && (
                                  <span className="p-1.5 text-amber-500">
                                    <Star className="h-4 w-4 fill-current" />
                                  </span>
                                )}

                                {/* Delete (only non-builtin) */}
                                {!model.is_builtin && (
                                  <button
                                    onClick={() => handleDelete(model.id)}
                                    className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
