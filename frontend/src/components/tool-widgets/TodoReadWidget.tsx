import React, { useState } from "react";
import { 
  CheckCircle2, 
  Circle, 
  Clock,
  Search,
  GitBranch,
  X,
  ListChecks,
  BarChart3,
  Download,
  LayoutGrid,
  LayoutList,
  Activity,
  Hash,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";

export const TodoReadWidget: React.FC<{ todos?: any[]; result?: any }> = ({ todos: inputTodos, result }) => {
  let todos: any[] = inputTodos || [];
  if (!todos.length && result) {
    if (typeof result === 'object' && Array.isArray(result.todos)) {
      todos = result.todos;
    } else if (typeof result.content === 'string') {
      try {
        const parsed = JSON.parse(result.content);
        if (Array.isArray(parsed)) todos = parsed;
        else if (parsed.todos) todos = parsed.todos;
      } catch (e) {
      }
    }
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "board" | "timeline" | "stats">("list");
  const [expandedTodos, setExpandedTodos] = useState<Set<string>>(new Set());

  const statusConfig = {
    completed: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/20",
      label: "Completed"
    },
    in_progress: {
      icon: <Clock className="h-4 w-4" />,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      label: "In Progress"
    },
    pending: {
      icon: <Circle className="h-4 w-4" />,
      color: "text-muted-foreground",
      bgColor: "bg-muted/50",
      borderColor: "border-muted",
      label: "Pending"
    },
    cancelled: {
      icon: <X className="h-4 w-4" />,
      color: "text-red-500",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
      label: "Cancelled"
    }
  };

  const filteredTodos = todos.filter(todo => {
    const matchesSearch = !searchQuery || 
      todo.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (todo.id && todo.id.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = statusFilter === "all" || todo.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: todos.length,
    completed: todos.filter(t => t.status === "completed").length,
    inProgress: todos.filter(t => t.status === "in_progress").length,
    pending: todos.filter(t => t.status === "pending").length,
    cancelled: todos.filter(t => t.status === "cancelled").length,
    completionRate: todos.length > 0 
      ? Math.round((todos.filter(t => t.status === "completed").length / todos.length) * 100)
      : 0
  };

  const todosByStatus = {
    pending: filteredTodos.filter(t => t.status === "pending"),
    in_progress: filteredTodos.filter(t => t.status === "in_progress"),
    completed: filteredTodos.filter(t => t.status === "completed"),
    cancelled: filteredTodos.filter(t => t.status === "cancelled")
  };

  const toggleExpanded = (todoId: string) => {
    setExpandedTodos(prev => {
      const next = new Set(prev);
      if (next.has(todoId)) {
        next.delete(todoId);
      } else {
        next.add(todoId);
      }
      return next;
    });
  };

  const exportAsJson = () => {
    const dataStr = JSON.stringify(todos, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'todos.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const exportAsMarkdown = () => {
    let markdown = "# Todo List\n\n";
    markdown += `**Total**: ${stats.total} | **Completed**: ${stats.completed} | **In Progress**: ${stats.inProgress} | **Pending**: ${stats.pending}\n\n`;
    
    const statusGroups = ["pending", "in_progress", "completed", "cancelled"];
    statusGroups.forEach(status => {
      const todosInStatus = todos.filter(t => t.status === status);
      if (todosInStatus.length > 0) {
        markdown += `## ${statusConfig[status as keyof typeof statusConfig]?.label || status}\n\n`;
        todosInStatus.forEach(todo => {
          const checkbox = todo.status === "completed" ? "[x]" : "[ ]";
          markdown += `- ${checkbox} ${todo.content}${todo.id ? ` (${todo.id})` : ""}\n`;
          if (todo.dependencies?.length > 0) {
            markdown += `  - Dependencies: ${todo.dependencies.join(", ")}\n`;
          }
        });
        markdown += "\n";
      }
    });
    
    const dataUri = 'data:text/markdown;charset=utf-8,'+ encodeURIComponent(markdown);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'todos.md');
    linkElement.click();
  };

  const TodoCard = ({ todo, isExpanded }: { todo: any; isExpanded: boolean }) => {
    const config = statusConfig[todo.status as keyof typeof statusConfig] || statusConfig.pending;
    
    return (
      <div
        className={cn(
          "group rounded-lg border p-4 transition-colors hover:bg-muted/40 cursor-pointer",
          config.bgColor,
          config.borderColor,
          todo.status === "completed" && "opacity-75"
        )}
        onClick={() => todo.id && toggleExpanded(todo.id)}
      >
        <div className="flex items-start gap-3">
          <div className={cn("mt-0.5", config.color)}>
            {config.icon}
          </div>
          <div className="flex-1 space-y-2">
            <p className={cn(
              "text-sm",
              todo.status === "completed" && "line-through"
            )}>
              {todo.content}
            </p>
            
            {/* Todo metadata */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {todo.id && (
                <div className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  <span className="font-mono">{todo.id}</span>
                </div>
              )}
              {todo.dependencies?.length > 0 && (
                <div className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  <span>{todo.dependencies.length} deps</span>
                </div>
              )}
            </div>
            
            {/* Expanded details */}
            {isExpanded && todo.dependencies?.length > 0 && (
              <div className="overflow-hidden">
                <div className="pt-2 mt-2 border-t space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Dependencies:</span>
                  <div className="flex flex-wrap gap-1">
                    {todo.dependencies.map((dep: string) => (
                      <Badge
                        key={dep}
                        variant="outline"
                        className="text-xs font-mono"
                      >
                        {dep}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render statistics view
  const StatsView = () => (
    <div className="space-y-4">
      {/* Overall Progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium">Overall Progress</h4>
          <span className="text-2xl font-bold text-primary">{stats.completionRate}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
          <div
            style={{ width: `${stats.completionRate}%` }}
            className="h-full bg-gradient-to-r from-primary to-primary/80"
          />
        </div>
      </Card>

      {/* Status Breakdown */}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(statusConfig).map(([status, config]) => {
          const count = stats[status as keyof typeof stats] || 0;
          const percentage = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
          
          return (
            <Card key={status} className={cn("p-4", config.bgColor)}>
              <div className="flex items-center gap-3">
                <div className={config.color}>{config.icon}</div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">{config.label}</p>
                  <p className="text-lg font-semibold">{count}</p>
                  <p className="text-xs text-muted-foreground">{percentage}%</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Activity Chart */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-medium">Activity Overview</h4>
        </div>
        <div className="space-y-2">
          {Object.entries(statusConfig).map(([status, config]) => {
            const count = stats[status as keyof typeof stats] || 0;
            const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0;
            
            return (
              <div key={status} className="flex items-center gap-3">
                <span className="text-xs w-20 text-right">{config.label}</span>
                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    style={{ width: `${percentage}%` }}
                    className={cn("h-full", config.bgColor)}
                  />
                </div>
                <span className="text-xs w-12 text-left">{count}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );

  // Render board view
  const BoardView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Object.entries(todosByStatus).map(([status, todos]) => {
        const config = statusConfig[status as keyof typeof statusConfig];
        
        return (
          <div key={status} className="space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b">
              <div className={config.color}>{config.icon}</div>
              <h3 className="text-sm font-medium">{config.label}</h3>
              <Badge variant="secondary" className="ml-auto text-xs">
                {todos.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {todos.map(todo => (
                <TodoCard 
                  key={todo.id || todos.indexOf(todo)} 
                  todo={todo} 
                  isExpanded={expandedTodos.has(todo.id)}
                />
              ))}
              {todos.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No todos
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Render timeline view
  const TimelineView = () => {
    // Group todos by their dependencies to create a timeline
    const rootTodos = todos.filter(t => !t.dependencies || t.dependencies.length === 0);
    const rendered = new Set<string>();
    
    const renderTodoWithDependents = (todo: any, level = 0) => {
      if (rendered.has(todo.id)) return null;
      rendered.add(todo.id);
      
      const dependents = todos.filter(t => 
        t.dependencies?.includes(todo.id) && !rendered.has(t.id)
      );
      
      return (
        <div key={todo.id} className="relative">
          {level > 0 && (
            <div className="absolute left-6 top-0 w-px h-6 bg-border" />
          )}
          <div className={cn("flex gap-4", level > 0 && "ml-12")}>
            <div className="relative">
              <div className={cn(
                "w-3 h-3 rounded-full border-2 bg-background",
                statusConfig[todo.status as keyof typeof statusConfig]?.borderColor
              )} />
              {dependents.length > 0 && (
                <div className="absolute left-1/2 top-3 w-px h-full bg-border -translate-x-1/2" />
              )}
            </div>
            <div className="flex-1 pb-6">
              <TodoCard 
                todo={todo} 
                isExpanded={expandedTodos.has(todo.id)}
              />
            </div>
          </div>
          {dependents.map(dep => renderTodoWithDependents(dep, level + 1))}
        </div>
      );
    };
    
    return (
      <div className="space-y-4">
        {rootTodos.map(todo => renderTodoWithDependents(todo))}
        {todos.filter(t => !rendered.has(t.id)).map(todo => renderTodoWithDependents(todo))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListChecks className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-medium">Todo Overview</h3>
            <p className="text-xs text-muted-foreground">
              {stats.total} total • {stats.completed} completed • {stats.completionRate}% done
            </p>
          </div>
        </div>
        
        {/* Export Options */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={exportAsJson}
          >
            <Download className="h-3 w-3 mr-1" />
            JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={exportAsMarkdown}
          >
            <Download className="h-3 w-3 mr-1" />
            Markdown
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search todos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        
        <div className="flex gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-md">
            {["all", "pending", "in_progress", "completed", "cancelled"].map(status => (
              <Button
                key={status}
                size="sm"
                variant={statusFilter === status ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? "All" : statusConfig[status as keyof typeof statusConfig]?.label}
                {status === "all" && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.total}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* View Mode Tabs */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="list" className="text-xs">
            <LayoutList className="h-4 w-4 mr-1" />
            List
          </TabsTrigger>
          <TabsTrigger value="board" className="text-xs">
            <LayoutGrid className="h-4 w-4 mr-1" />
            Board
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs">
            <GitBranch className="h-4 w-4 mr-1" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-xs">
            <BarChart3 className="h-4 w-4 mr-1" />
            Stats
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="space-y-2">
            {filteredTodos.map(todo => (
              <TodoCard
                key={todo.id || filteredTodos.indexOf(todo)}
                todo={todo}
                isExpanded={expandedTodos.has(todo.id)}
              />
            ))}
            {filteredTodos.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {searchQuery || statusFilter !== "all" 
                  ? "No todos match your filters" 
                  : "No todos available"}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="board" className="mt-4">
          <BoardView />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelineView />
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <StatsView />
        </TabsContent>
      </Tabs>
    </div>
  );
};
