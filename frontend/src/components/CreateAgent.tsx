import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle,
  FolderGit2,
  Globe,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
  Zap,
  ChevronDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Toast, ToastContainer } from "@/components/ui/toast";
import { api, type Agent, type ModelConfig, type Project, type ProviderApiConfig } from "@/lib/api";
import { open as openDialog } from "@/lib/dialog";
import type { agentpacks } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import MDEditor from "@uiw/react-md-editor";
import { type AgentIconName } from "./CCAgents";
import { IconPicker, ICON_MAP } from "./IconPicker";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateAgentProps {
  agent?: Agent;
  onBack: () => void;
  onAgentCreated: (summary?: agentpacks.InstalledPackSummary) => void;
  className?: string;
}

type ProviderID = "claude" | "codex" | "gemini" | "pi" | "deepseek";

type SkillDraft = {
  localId: string;
  name: string;
  sourcePath: string;
  instructions: string;
};

type TriggerMode = "manual" | "scheduled" | "event";
type SchedulePreset = "hourly" | "daily" | "weekdays" | "weekly";

type ScopeTarget = {
  kind: "project" | "workspace";
  path: string;
  name: string;
  projectName?: string;
};

type TargetGroup = {
  key: string;
  name: string;
  path: string;
  targets: ScopeTarget[];
};

const PROVIDERS: Array<{
  id: ProviderID;
  label: string;
  detail: string;
}> = [
  { id: "claude", label: "Claude", detail: "Claude Code" },
  { id: "codex", label: "Codex", detail: "OpenAI Codex" },
  { id: "gemini", label: "Gemini", detail: "Gemini CLI" },
  { id: "pi", label: "Pi", detail: "Pi coding agent" },
  { id: "deepseek", label: "DeepSeek", detail: "DeepSeek CLI" },
];

const FALLBACK_MODELS: Record<string, string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex: ["gpt-5", "gpt-5-codex"],
  gemini: ["gemini-pro"],
  pi: ["default"],
  deepseek: ["deepseek-chat"],
};

const SCHEDULE_PRESETS: Array<{ id: SchedulePreset; label: string; description: string }> = [
  { id: "hourly", label: "Hourly", description: "Run at the top of every hour" },
  { id: "daily", label: "Daily", description: "Run once per day" },
  { id: "weekdays", label: "Weekdays", description: "Run Monday through Friday" },
  { id: "weekly", label: "Weekly", description: "Run once per week" },
];

type EventPreset = {
  id: string;
  label: string;
  description: string;
  sessionScoped?: boolean;
  agentRunScoped?: boolean;
};

type EventDraft = {
  localId: string;
  eventType: string;
  agentId: string;
};

const EVENT_GROUPS: Array<{ label: string; events: EventPreset[] }> = [
  {
    label: "Git",
    events: [
      { id: "git.dirty", label: "Git dirty", description: "Runs when a watched workspace gets uncommitted changes." },
      { id: "git.clean", label: "Git clean", description: "Runs when a watched workspace returns to a clean state." },
    ],
  },
  {
    label: "Project",
    events: [
      { id: "project.changed", label: "Project changed", description: "Runs when a project or workspace is added, removed, or updated." },
    ],
  },
  {
    label: "Process",
    events: [
      { id: "process.started", label: "Process started", description: "Runs when a provider process starts.", sessionScoped: true },
      { id: "process.stopped", label: "Process stopped", description: "Runs when a provider process exits or is stopped.", sessionScoped: true },
      { id: "process.changed", label: "Process changed", description: "Runs for process state changes that do not map to started or stopped.", sessionScoped: true },
    ],
  },
  {
    label: "Session",
    events: [
      { id: "session.started", label: "Session started", description: "Runs when a provider session starts or becomes active.", sessionScoped: true },
      { id: "session.idle", label: "Session idle", description: "Runs when a provider session becomes idle.", sessionScoped: true },
      { id: "session.completed", label: "Session completed", description: "Runs after a provider session completes.", sessionScoped: true },
      { id: "session.compacted", label: "Session compacted", description: "Runs after a provider session compacts context.", sessionScoped: true },
      { id: "session.changed", label: "Session changed", description: "Runs for session state changes that do not map to a more specific session event.", sessionScoped: true },
    ],
  },
  {
    label: "Agent Run",
    events: [
      { id: "agent.run.pending", label: "Agent run pending", description: "Runs when an agent run is queued.", agentRunScoped: true },
      { id: "agent.run.started", label: "Agent run started", description: "Runs when an agent run starts.", agentRunScoped: true },
      { id: "agent.run.completed", label: "Agent run completed", description: "Runs when an agent run completes successfully.", agentRunScoped: true },
      { id: "agent.run.failed", label: "Agent run failed", description: "Runs when an agent run fails.", agentRunScoped: true },
      { id: "agent.run.cancelled", label: "Agent run cancelled", description: "Runs when an agent run is cancelled.", agentRunScoped: true },
      { id: "agent.run.changed", label: "Agent run changed", description: "Runs for agent run status changes that do not map to a more specific run event.", agentRunScoped: true },
    ],
  },
  {
    label: "Advanced",
    events: [
      { id: "*", label: "Any domain event", description: "Runs for any domain event that matches the selected target scope." },
    ],
  },
];

const EVENT_PRESETS = EVENT_GROUPS.flatMap((group) => group.events);

const newEventDraft = (eventType: string): EventDraft => ({
  localId: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  eventType,
  agentId: "",
});

const newSkillDraft = (name = "Core Skill"): SkillDraft => ({
  localId: `skill-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name,
  sourcePath: "",
  instructions: "",
});

const skillNameFromPath = (path: string): string => {
  const normalized = path.replace(/\\/g, "/").replace(/\/SKILL\.md$/i, "");
  return normalized.split("/").filter(Boolean).pop() || "Imported Skill";
};

const cronForPreset = (preset: SchedulePreset, time: string): string => {
  const [hour = "9", minute = "0"] = time.split(":");
  const h = Math.max(0, Math.min(23, Number.parseInt(hour, 10) || 0));
  const m = Math.max(0, Math.min(59, Number.parseInt(minute, 10) || 0));
  switch (preset) {
    case "hourly":
      return `0 * * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * 1`;
    case "daily":
    default:
      return `${m} ${h} * * *`;
  }
};

const projectPath = (project: Project): string => {
  return project.path || project.providers?.[0]?.path || "";
};

const workspacePath = (workspace: NonNullable<Project["workspaces"]>[number]): string => {
  return workspace.providers?.[0]?.path || workspace.id || "";
};

const projectTargetGroups = (projects: Project[]): TargetGroup[] => {
  const groups: TargetGroup[] = [];
  for (const project of projects) {
    const path = projectPath(project);
    const targets: ScopeTarget[] = [];
    if (path) {
      targets.push({ kind: "project", path, name: project.name || path });
    }
    for (const workspace of project.workspaces ?? []) {
      const wsPath = workspacePath(workspace);
      if (!wsPath) continue;
      targets.push({
        kind: "workspace",
        path: wsPath,
        name: workspace.name || workspace.branch || wsPath,
        projectName: project.name || path,
      });
    }
    if (targets.length > 0) {
      groups.push({
        key: path || project.name || targets[0].path,
        name: project.name || path || "Project",
        path,
        targets,
      });
    }
  }
  return groups;
};

const slugPreview = (value: string, fallback: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
};

const modelOptionsForProvider = (
  provider: string,
  modelsByProvider: Record<string, ModelConfig[]>
): Array<{ id: string; label: string; description?: string }> => {
  const providerModels = modelsByProvider[provider] ?? [];
  const fallbackModels = FALLBACK_MODELS[provider] ?? [];
  return providerModels.length > 0
    ? providerModels.map((model) => ({
        id: model.model_id,
        label: model.display_name || model.model_id,
        description: model.description,
      }))
    : fallbackModels.map((model) => ({ id: model, label: model }));
};

export const CreateAgent: React.FC<CreateAgentProps> = ({
  agent,
  onBack,
  onAgentCreated,
  className,
}) => {
  const [name, setName] = useState(agent?.name || "");
  const [description, setDescription] = useState("");
  const [selectedIcon, setSelectedIcon] = useState<AgentIconName>((agent?.icon as AgentIconName) || "bot");
  const [rolePrompt, setRolePrompt] = useState(agent?.system_prompt || "");
  const [defaultTask, setDefaultTask] = useState(agent?.default_task || "");
  const [provider, setProvider] = useState<ProviderID>("claude");
  const [model, setModel] = useState(agent?.model || "sonnet");
  const [providerApiId, setProviderApiId] = useState<string | null>(agent?.provider_api_id || null);
  const [enabled, setEnabled] = useState(true);
  const [skills, setSkills] = useState<SkillDraft[]>([newSkillDraft()]);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("manual");
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>("daily");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [selectedEvents, setSelectedEvents] = useState<EventDraft[]>([]);
  const [targetScope, setTargetScope] = useState<"all" | "selected">("all");
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [expandedTargetGroups, setExpandedTargetGroups] = useState<Record<string, boolean>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderApiConfig[]>([]);
  const [loadingRuntime, setLoadingRuntime] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);

  useEffect(() => {
    void loadRuntimeOptions();
    void loadProjects();
  }, []);

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, ModelConfig[]> = {};
    for (const item of models) {
      if (!item.is_enabled) continue;
      const providerID = item.provider_id || item.provider_name || "claude";
      grouped[providerID] = [...(grouped[providerID] ?? []), item];
    }
    return grouped;
  }, [models]);

  const apiConfigsByProvider = useMemo(() => {
    const grouped: Record<string, ProviderApiConfig[]> = {};
    for (const config of providerConfigs) {
      grouped[config.provider_id] = [...(grouped[config.provider_id] ?? []), config];
    }
    return grouped;
  }, [providerConfigs]);

  const modelOptions = modelOptionsForProvider(provider, modelsByProvider);
  const apiOptions = apiConfigsByProvider[provider] ?? [];
  const targetGroups = useMemo(() => projectTargetGroups(projects), [projects]);
  const availableTargets = useMemo(() => targetGroups.flatMap((group) => group.targets), [targetGroups]);
  const selectedIconComponent = ICON_MAP[selectedIcon] || ICON_MAP.bot;
  const packIDPreview = `local.${slugPreview(name, "agent-pack")}`;
  const agentIDPreview = slugPreview(name, "agent");
  const currentConfig = providerApiId
    ? apiOptions.find((config) => config.id === providerApiId)
    : apiOptions.find((config) => config.is_default);

  const loadRuntimeOptions = async () => {
    try {
      setLoadingRuntime(true);
      const [modelConfigs, apiConfigs] = await Promise.all([
        api.getEnabledModelConfigs?.() ?? api.getAllModelConfigs(),
        api.listProviderApiConfigs(),
      ]);
      setModels(modelConfigs ?? []);
      setProviderConfigs(apiConfigs ?? []);
    } catch (err) {
      console.error("Failed to load runtime options:", err);
      setToast({ message: "Failed to load provider runtime options", type: "error" });
    } finally {
      setLoadingRuntime(false);
    }
  };

  const loadProjects = async () => {
    try {
      const list = await api.listProjects();
      setProjects(list ?? []);
    } catch (err) {
      console.error("Failed to load projects for agent targets:", err);
      setProjects([]);
    }
  };

  useEffect(() => {
    if (!model) {
      setModel(modelOptions[0]?.id || FALLBACK_MODELS[provider]?.[0] || "");
      return;
    }
    if (modelOptions.length > 0 && !modelOptions.some((option) => option.id === model)) {
      setModel(modelOptions[0].id);
    }
  }, [model, modelOptions, provider]);

  const selectProvider = (nextProvider: ProviderID) => {
    const nextModel = modelOptionsForProvider(nextProvider, modelsByProvider)[0]?.id || FALLBACK_MODELS[nextProvider]?.[0] || "";
    setProvider(nextProvider);
    setModel(nextModel);
    setProviderApiId(null);
  };

  const addSkill = async () => {
    try {
      const result = await openDialog({ directory: true });
      if (result.canceled || !result.filePaths?.[0]) {
        return;
      }
      const sourcePath = result.filePaths[0];
      const skillName = skillNameFromPath(sourcePath);
      const skill = newSkillDraft(skillName);
      skill.sourcePath = sourcePath;
      setSkills((current) => {
        const hasOnlyEmptyDraft = current.length === 1 && !current[0].sourcePath && !current[0].instructions.trim();
        return hasOnlyEmptyDraft ? [skill] : [...current, skill];
      });
    } catch (err) {
      console.error("Failed to import skill:", err);
      const message = err instanceof Error ? err.message : "Failed to import skill";
      setToast({ message, type: "error" });
    }
  };

  const removeSkill = (skillID: string) => {
    setSkills((current) => {
      const next = current.filter((skill) => skill.localId !== skillID);
      if (next.length === 0 || !next.some((skill) => skill.sourcePath || skill.instructions.trim())) {
        return [newSkillDraft()];
      }
      return next;
    });
  };

  const toggleTarget = (path: string) => {
    setSelectedTargets((current) => (
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path]
    ));
  };

  const toggleTargetGroup = (group: TargetGroup) => {
    const groupPaths = group.targets.map((target) => target.path);
    setSelectedTargets((current) => {
      const currentSet = new Set(current);
      const allSelected = groupPaths.every((path) => currentSet.has(path));
      if (allSelected) {
        return current.filter((path) => !groupPaths.includes(path));
      }
      for (const path of groupPaths) {
        currentSet.add(path);
      }
      return Array.from(currentSet);
    });
  };

  const toggleTargetGroupExpanded = (groupKey: string) => {
    setExpandedTargetGroups((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? targetGroups.length <= 3),
    }));
  };

  const addEventTrigger = (event: string) => {
    setSelectedEvents((current) => current.some((item) => item.eventType === event) ? current : [...current, newEventDraft(event)]);
  };

  const removeEventTrigger = (localId: string) => {
    setSelectedEvents((current) => current.filter((item) => item.localId !== localId));
  };

  const updateEventTrigger = (localId: string, patch: Partial<EventDraft>) => {
    setSelectedEvents((current) => current.map((item) => (
      item.localId === localId ? { ...item, ...patch } : item
    )));
  };

  const hasUnsavedChanges = () => {
    return Boolean(
      name.trim() ||
      description.trim() ||
      rolePrompt.trim() ||
      defaultTask.trim() ||
      triggerMode !== "manual" ||
      schedulePreset !== "daily" ||
      scheduleTime !== "09:00" ||
      selectedEvents.length > 0 ||
      targetScope !== "all" ||
      selectedTargets.length > 0 ||
      skills.some((skill) => skill.name.trim() !== "Core Skill" || skill.sourcePath || skill.instructions.trim())
    );
  };

  const handleBack = () => {
    if (hasUnsavedChanges() && !confirm("You have unsaved changes. Are you sure you want to leave?")) {
      return;
    }
    onBack();
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedRole = rolePrompt.trim();
    if (!trimmedName) {
      setError("Agent name is required");
      return;
    }
    if (!trimmedRole) {
      setError("Role is required");
      return;
    }
    if (!provider || !model) {
      setError("Provider and model are required");
      return;
    }
    if (triggerMode === "scheduled" && selectedTargets.length === 0) {
      setError("Select at least one project or workspace for scheduled runs");
      return;
    }
    if (triggerMode === "event" && selectedEvents.length === 0) {
      setError("Select at least one event");
      return;
    }
    if (triggerMode === "event" && selectedEvents.some((event) => {
      const preset = EVENT_PRESETS.find((item) => item.id === event.eventType);
      return preset?.agentRunScoped && !event.agentId.trim();
    })) {
      setError("Enter an agent ID for agent run events, or use any");
      return;
    }

    const selectedTargetDetails = availableTargets.filter((target) => selectedTargets.includes(target.path));
    const scheduledScope = {
      type: "selected",
      targets: selectedTargetDetails.map((target) => ({
        type: target.kind,
        path: target.path,
        name: target.name,
        project_name: target.projectName || "",
      })),
    };
    const triggers: agentpacks.TriggerConfig[] = triggerMode === "scheduled"
      ? [{
          mode: "schedule",
          enabled: true,
          schedule: cronForPreset(schedulePreset, scheduleTime),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
          scope: {
            ...scheduledScope,
            preset: schedulePreset,
            time: scheduleTime,
          },
        }]
      : triggerMode === "event"
      ? selectedEvents.map((event) => {
          const preset = EVENT_PRESETS.find((item) => item.id === event.eventType);
          return {
            mode: "event",
            enabled: true,
            event: event.eventType,
            event_type: event.eventType,
            session_type: preset?.sessionScoped ? "user" : "",
            session_agent_id: "",
            agent_id: preset?.agentRunScoped ? event.agentId.trim() : "",
            scope: { type: "event-source" },
          };
        })
      : [{
          mode: "manual",
          enabled: true,
          scope: { type: "runtime-selected" },
        }];

    try {
      setSaving(true);
      setError(null);

      const summary = await api.createLocalAgentPack({
        name: trimmedName,
        description: description.trim(),
        agent: {
          name: trimmedName,
          icon: selectedIcon,
          description: description.trim(),
          role_prompt: trimmedRole,
          skills: skills
            .filter((skill) => skill.sourcePath || skill.instructions.trim())
            .map((skill, index) => ({
              name: skill.name.trim() || `Skill ${index + 1}`,
              source_path: skill.sourcePath,
              instructions: skill.instructions.trim(),
            })),
          default_task: defaultTask.trim(),
        },
        runtime: {
          provider,
          model,
          provider_api_id: providerApiId || "",
          config: {},
        },
        enabled,
        triggers,
      });

      setToast({ message: `${summary.name} created`, type: "success" });
      onAgentCreated(summary);
    } catch (err) {
      console.error("Failed to create agent pack:", err);
      const message = err instanceof Error ? err.message : "Failed to create agent";
      setError(message);
      setToast({ message, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("h-full overflow-y-auto bg-background", className)}
    >
      <div className="mx-auto flex h-full max-w-7xl flex-col">
        <div className="border-b border-border p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                className="-ml-2 h-9 w-9 shrink-0"
                title="Back to Agents"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-heading-1">Create Agent</h1>
                  <span className="rounded-full border px-2 py-0.5 text-caption text-muted-foreground">Agent Pack</span>
                </div>
                <p className="mt-1 max-w-2xl text-body-small text-muted-foreground">
                  Build a distributable local agent with a role, reusable skills, and a selected runtime provider.
                </p>
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || !rolePrompt.trim()}
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
                  Save Agent
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="mx-6 mt-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="text-caption text-destructive">{error}</span>
          </motion.div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-6xl space-y-5">
            <Card className="p-5">
              <div className="mb-5 flex items-center gap-2">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-heading-4">Identity</h3>
              </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="agent-name" className="text-caption text-muted-foreground">Agent Name</Label>
                    <Input
                      id="agent-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g., Code Review Helper"
                      className="h-9"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-caption text-muted-foreground">Agent Icon</Label>
                    <button
                      type="button"
                      onClick={() => setShowIconPicker(true)}
                      className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="flex items-center gap-2">
                        {React.createElement(selectedIconComponent, { className: "h-4 w-4" })}
                        <span>{selectedIcon}</span>
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="agent-description" className="text-caption text-muted-foreground">Description</Label>
                    <Input
                      id="agent-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="What this agent is good at"
                      className="h-9"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="default-task" className="text-caption text-muted-foreground">Default Task</Label>
                    <Input
                      id="default-task"
                      value={defaultTask}
                      onChange={(event) => setDefaultTask(event.target.value)}
                      placeholder="e.g., Review current changes for regressions"
                      className="h-9"
                    />
                  </div>
                </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-stretch">
                  <div className="grid gap-2 rounded-md border bg-muted/15 p-3 text-sm sm:grid-cols-3">
                    <div className="min-w-0">
                      <div className="text-caption text-muted-foreground">Pack ID</div>
                      <code className="block truncate text-caption">{packIDPreview}</code>
                    </div>
                    <div className="min-w-0">
                      <div className="text-caption text-muted-foreground">Agent ID</div>
                      <code className="block truncate text-caption">{agentIDPreview}</code>
                    </div>
                    <div className="min-w-0">
                      <div className="text-caption text-muted-foreground">Install path</div>
                      <code className="block truncate text-caption">~/.ropcode/agent-packs</code>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/15 p-3 md:min-w-56">
                    <div>
                      <div className="text-sm font-medium">Enabled</div>
                      <div className="text-caption text-muted-foreground">Active after creation</div>
                    </div>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                  </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-5 flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-heading-4">Runtime</h3>
              </div>

                {loadingRuntime ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/15 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading providers
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="space-y-2">
                        <Label className="text-caption text-muted-foreground">Provider</Label>
                        <Select value={provider} onValueChange={(value) => selectProvider(value as ProviderID)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVIDERS.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-caption text-muted-foreground">Model</Label>
                        <Select value={model || modelOptions[0]?.id || ""} onValueChange={setModel}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {modelOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-caption text-muted-foreground">API Configuration</Label>
                        <Select
                          value={providerApiId || "default"}
                          onValueChange={(value) => setProviderApiId(value === "default" ? null : value)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select API" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Use Default</SelectItem>
                            {apiOptions.filter((config) => !!config.id).map((config) => (
                              <SelectItem key={config.id} value={config.id || "default"}>
                                {config.name}{config.is_default ? " (Default)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-md border bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {currentConfig ? (
                            <CheckCircle className="h-4 w-4 text-primary" />
                          ) : (
                            <Globe className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="truncate">{currentConfig ? currentConfig.name : "Default provider environment"}</span>
                        </div>
                        <div className="mt-1 truncate text-caption text-muted-foreground">
                          {currentConfig?.base_url || "Uses the selected provider's default CLI or environment configuration."}
                        </div>
                      </div>
                      <div className="shrink-0 rounded bg-background px-2 py-1 text-caption text-muted-foreground">
                        {PROVIDERS.find((item) => item.id === provider)?.detail}
                      </div>
                    </div>
                  </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-5 flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-heading-4">Automation</h3>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <div className="space-y-2">
                    <Label className="text-caption text-muted-foreground">Trigger</Label>
                    <Select value={triggerMode} onValueChange={(value) => setTriggerMode(value as TriggerMode)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="scheduled">Time driven</SelectItem>
                        <SelectItem value="event">Event driven</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-md border bg-muted/10 p-3 text-sm text-muted-foreground">
                    {triggerMode === "manual" && "The agent is installed and can be started manually from the Agents surface."}
                    {triggerMode === "scheduled" && "The scheduler runs this agent automatically at the selected time for the chosen targets."}
                    {triggerMode === "event" && "The event listener runs this agent when the selected project, workspace, git, or session event arrives."}
                  </div>
                </div>

                {triggerMode === "scheduled" && (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                    <div className="space-y-2">
                      <Label className="text-caption text-muted-foreground">Frequency</Label>
                      <Select value={schedulePreset} onValueChange={(value) => setSchedulePreset(value as SchedulePreset)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SCHEDULE_PRESETS.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="text-caption text-muted-foreground">
                        {SCHEDULE_PRESETS.find((preset) => preset.id === schedulePreset)?.description}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="schedule-time" className="text-caption text-muted-foreground">Time</Label>
                      <Input
                        id="schedule-time"
                        type="time"
                        value={scheduleTime}
                        onChange={(event) => setScheduleTime(event.target.value)}
                        disabled={schedulePreset === "hourly"}
                        className="h-9"
                      />
                    </div>
                  </div>
                )}

                {triggerMode === "event" && (
                  <div className="space-y-2">
                    <Label className="text-caption text-muted-foreground">Events</Label>
                    <Select value="" onValueChange={addEventTrigger}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Add event trigger" />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_GROUPS.map((group, groupIndex) => (
                          <React.Fragment key={group.label}>
                            {groupIndex > 0 && <SelectSeparator />}
                            <SelectGroup>
                              <SelectLabel className="text-xs text-muted-foreground">{group.label}</SelectLabel>
                              {group.events.map((preset) => (
                                <SelectItem key={preset.id} value={preset.id} disabled={selectedEvents.some((event) => event.eventType === preset.id)}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </React.Fragment>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedEvents.length === 0 ? (
                      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                        No event triggers selected.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedEvents.map((event) => {
                          const preset = EVENT_PRESETS.find((item) => item.id === event.eventType);
                          return (
                            <div key={event.localId} className="rounded-md border bg-muted/10 p-3">
                              <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{preset?.label || event.eventType}</div>
                                <div className="mt-1 line-clamp-2 text-caption text-muted-foreground">{preset?.description || event.eventType}</div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeEventTrigger(event.localId)}
                                title="Remove event"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              </div>

                              {preset?.agentRunScoped && (
                                <div className="mt-3 space-y-1">
                                  <Label className="text-caption text-muted-foreground">Agent source</Label>
                                  <Input
                                    value={event.agentId}
                                    onChange={(inputEvent) => updateEventTrigger(event.localId, { agentId: inputEvent.target.value })}
                                    placeholder="agent id, pack/agent id, or any"
                                    className="h-8"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {triggerMode === "manual" && (
                  <div className="rounded-md border bg-muted/10 p-3 text-sm text-muted-foreground">
                    Manual runs choose the project or workspace at launch time.
                  </div>
                )}

                {triggerMode === "event" && (
                  <div className="rounded-md border bg-muted/10 p-3 text-sm text-muted-foreground">
                    Event runs use the project or workspace carried by the matching event.
                  </div>
                )}

                {triggerMode === "scheduled" && (
                  <div className="rounded-md border bg-muted/10 p-3">
                    <div className="mb-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                        Scheduled Targets
                      </div>
                      <div className="mt-1 text-caption text-muted-foreground">
                        Choose one or more projects or workspaces for time-driven runs.
                      </div>
                    </div>

                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {targetGroups.length === 0 ? (
                        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                          No projects or workspaces are available yet.
                        </div>
                      ) : (
                        targetGroups.map((group) => {
                          const selectedCount = group.targets.filter((target) => selectedTargets.includes(target.path)).length;
                          const expanded = expandedTargetGroups[group.key] ?? targetGroups.length <= 3;
                          const allSelected = selectedCount === group.targets.length;
                          return (
                            <div key={group.key} className={cn(
                              "overflow-hidden rounded-md border bg-background/50",
                              selectedCount > 0 && "border-primary/60 bg-primary/5"
                            )}>
                              <div className="flex items-center gap-2 p-2">
                                <button
                                  type="button"
                                  onClick={() => toggleTargetGroupExpanded(group.key)}
                                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left hover:bg-muted/40"
                                >
                                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{group.name}</span>
                                    <span className="block truncate text-caption text-muted-foreground">{group.path || `${group.targets.length} targets`}</span>
                                  </span>
                                  <span className={cn(
                                    "shrink-0 rounded-full border px-2 py-0.5 text-caption",
                                    selectedCount > 0 ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground"
                                  )}>
                                    {selectedCount}/{group.targets.length}
                                  </span>
                                </button>
                                <Button
                                  type="button"
                                  variant={allSelected ? "secondary" : "outline"}
                                  size="sm"
                                  className="h-8 shrink-0"
                                  onClick={() => toggleTargetGroup(group)}
                                >
                                  {allSelected ? "Clear" : "Select"}
                                </Button>
                              </div>

                              {expanded && (
                                <div className="space-y-1 border-t bg-muted/10 p-2">
                                  {group.targets.map((target) => {
                                    const checked = selectedTargets.includes(target.path);
                                    return (
                                      <button
                                        key={target.path}
                                        type="button"
                                        onClick={() => toggleTarget(target.path)}
                                        className={cn(
                                          "flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm transition-colors",
                                          checked ? "border-primary/60 bg-primary/10" : "border-transparent bg-background/60 hover:bg-muted/30"
                                        )}
                                      >
                                        <span className={cn(
                                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                                          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                                        )}>
                                          {checked && <CheckCircle className="h-3.5 w-3.5" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="flex items-center gap-2">
                                            <span className="truncate font-medium">{target.name}</span>
                                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-muted-foreground">
                                              {target.kind}
                                            </span>
                                          </span>
                                          <span className="block truncate text-caption text-muted-foreground">{target.path}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-heading-4">Role</h3>
                  <p className="mt-1 text-caption text-muted-foreground">
                    Define the agent's responsibility, behavior, boundaries, and output style.
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-md border bg-muted/15 px-2 py-1 text-caption text-muted-foreground">
                  <Zap className="h-3.5 w-3.5" />
                  Required
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-border" data-color-mode="dark">
                <MDEditor
                  value={rolePrompt}
                  onChange={(value) => setRolePrompt(value || "")}
                  preview="edit"
                  height={380}
                  visibleDragbar={false}
                  textareaProps={{
                    placeholder: "You are a focused code review agent. Prioritize bugs, regressions, missing tests, and unclear behavior. Be concise and cite files when possible.",
                  }}
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-heading-4">Skills</h3>
                  <p className="mt-1 text-caption text-muted-foreground">
                    Import complete Skill folders. Resources beside SKILL.md are copied into the agent pack unchanged.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void addSkill()}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Import Skill
                </Button>
              </div>

              {skills.some((skill) => skill.sourcePath) ? (
                <div className="space-y-3">
                  {skills.filter((skill) => skill.sourcePath).map((skill, index) => {
                    const skillSlug = slugPreview(skill.name || `skill-${index + 1}`, `skill-${index + 1}`);
                    return (
                      <div key={skill.localId} className="rounded-md border bg-muted/10 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{skill.name || `Skill ${index + 1}`}</div>
                            <div className="mt-1 truncate text-caption text-muted-foreground">
                              {skill.sourcePath}
                            </div>
                            <div className="mt-1 truncate text-caption text-muted-foreground">
                              skills/{skillSlug}/SKILL.md
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeSkill(skill.localId)}
                            title="Remove skill"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/10 p-5 text-sm text-muted-foreground">
                  No skills imported. Use Import Skill to attach a folder that contains SKILL.md.
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <ToastContainer>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastContainer>

      <IconPicker
        value={selectedIcon}
        onSelect={(iconName) => {
          setSelectedIcon(iconName as AgentIconName);
          setShowIconPicker(false);
        }}
        isOpen={showIconPicker}
        onClose={() => setShowIconPicker(false)}
      />
    </motion.div>
  );
};
