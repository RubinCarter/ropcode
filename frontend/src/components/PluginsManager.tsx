import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package,
  ChevronDown,
  ChevronRight,
  Bot,
  Terminal,
  Sparkles,
  Webhook,
  Loader2,
  ExternalLink,
  Calendar,
  GitBranch,
  FolderOpen,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  api,
  type InstalledPlugin,
  type PluginContents,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface PluginsManagerProps {
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export const PluginsManager: React.FC<PluginsManagerProps> = ({ setToast }) => {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [pluginContents, setPluginContents] = useState<Record<string, PluginContents>>({});
  const [loadingContents, setLoadingContents] = useState<string | null>(null);

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    try {
      setLoading(true);
      const loadedPlugins = await api.listInstalledPlugins();
      setPlugins(loadedPlugins);
    } catch (error) {
      console.error("Failed to load plugins:", error);
      setToast({ message: "Failed to load plugins", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const togglePlugin = async (pluginId: string) => {
    if (expandedPlugin === pluginId) {
      setExpandedPlugin(null);
      return;
    }

    setExpandedPlugin(pluginId);

    // Load contents if not already loaded
    if (!pluginContents[pluginId]) {
      try {
        setLoadingContents(pluginId);
        const contents = await api.getPluginContents(pluginId);
        setPluginContents((prev) => ({ ...prev, [pluginId]: contents }));
      } catch (error) {
        console.error("Failed to load plugin contents:", error);
        setToast({ message: "Failed to load plugin contents", type: "error" });
      } finally {
        setLoadingContents(null);
      }
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-heading-4 mb-2">Installed Plugins</h3>
          <p className="text-body-small text-muted-foreground">
            Browse Claude Code plugins installed via{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs">/plugins install</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadPlugins} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Plugin List */}
      {plugins.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium">No plugins installed</p>
          <p className="text-sm mt-2">
            Install plugins using Claude Code CLI:{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs">/plugins install [name]</code>
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {plugins.map((plugin) => (
            <motion.div
              key={plugin.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="overflow-hidden">
                {/* Plugin Header */}
                <button
                  className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
                  onClick={() => togglePlugin(plugin.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">{plugin.name}</h4>
                        <Badge variant="secondary" className="text-xs">
                          v{plugin.version}
                        </Badge>
                        {plugin.is_local && (
                          <Badge variant="outline" className="text-xs">
                            Local
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {plugin.metadata?.description || plugin.marketplace || "No description"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {loadingContents === plugin.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : expandedPlugin === plugin.id ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Plugin Details */}
                <AnimatePresence>
                  {expandedPlugin === plugin.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t px-4 py-4 bg-muted/30 space-y-4">
                        {/* Metadata */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span>Installed: {formatDate(plugin.installed_at)}</span>
                          </div>
                          {plugin.git_commit_sha && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <GitBranch className="h-4 w-4" />
                              <span className="font-mono text-xs">
                                {plugin.git_commit_sha.substring(0, 7)}
                              </span>
                            </div>
                          )}
                          {plugin.metadata?.homepage && (
                            <a
                              href={plugin.metadata.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-primary hover:underline"
                            >
                              <ExternalLink className="h-4 w-4" />
                              <span>Homepage</span>
                            </a>
                          )}
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <FolderOpen className="h-4 w-4" />
                            <span className="truncate text-xs font-mono" title={plugin.install_path}>
                              {plugin.install_path.split("/").slice(-2).join("/")}
                            </span>
                          </div>
                        </div>

                        {/* Keywords */}
                        {plugin.metadata?.keywords && plugin.metadata.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {plugin.metadata.keywords.map((keyword, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Contents */}
                        {pluginContents[plugin.id] && (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                            {/* Agents */}
                            <ContentCard
                              icon={<Bot className="h-4 w-4" />}
                              label="Agents"
                              count={pluginContents[plugin.id].agents.length}
                              items={pluginContents[plugin.id].agents.map((a) => a.name)}
                            />

                            {/* Commands */}
                            <ContentCard
                              icon={<Terminal className="h-4 w-4" />}
                              label="Commands"
                              count={pluginContents[plugin.id].commands.length}
                              items={pluginContents[plugin.id].commands.map(
                                (c) => `/${plugin.name}:${c.name}`
                              )}
                            />

                            {/* Skills */}
                            <ContentCard
                              icon={<Sparkles className="h-4 w-4" />}
                              label="Skills"
                              count={pluginContents[plugin.id].skills.length}
                              items={pluginContents[plugin.id].skills.map((s) => s.name)}
                            />

                            {/* Hooks */}
                            <ContentCard
                              icon={<Webhook className="h-4 w-4" />}
                              label="Hooks"
                              count={pluginContents[plugin.id].hooks.length}
                              items={pluginContents[plugin.id].hooks.map((h) => h.event_type)}
                            />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Info Card */}
      <Card className="p-4 bg-muted/30 border-border">
        <div className="flex gap-2">
          <AlertCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-medium">About Claude Code Plugins</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>
                Plugins are installed via Claude Code CLI:{" "}
                <code className="px-1 py-0.5 bg-background rounded">/plugins install [name]</code>
              </li>
              <li>
                Plugin commands use format:{" "}
                <code className="px-1 py-0.5 bg-background rounded">/plugin-name:command</code>
              </li>
              <li>Plugin agents can be invoked with @plugin-name:agent-name</li>
              <li>Skills are automatically loaded when relevant to your task</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};

// Helper component for content cards
interface ContentCardProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  items: string[];
}

const ContentCard: React.FC<ContentCardProps> = ({ icon, label, count, items }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3 cursor-pointer hover:border-primary/50 transition-colors",
        count === 0 && "opacity-50"
      )}
      onClick={() => count > 0 && setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <Badge variant={count > 0 ? "default" : "secondary"} className="text-xs">
          {count}
        </Badge>
      </div>

      {expanded && items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
        >
          <ScrollArea className="max-h-32 mt-2">
            <ul className="text-xs text-muted-foreground space-y-1">
              {items.map((item, idx) => (
                <li key={idx} className="truncate font-mono">
                  {item}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </motion.div>
      )}
    </div>
  );
};
