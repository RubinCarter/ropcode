export namespace checkpoint {
	
	export class Checkpoint {
	    id: string;
	    session_id: string;
	    parent_checkpoint_id?: string;
	    message_index: number;
	    // Go type: time
	    timestamp: any;
	    description?: string;
	    trigger_type: string;
	
	    static createFrom(source: any = {}) {
	        return new Checkpoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.session_id = source["session_id"];
	        this.parent_checkpoint_id = source["parent_checkpoint_id"];
	        this.message_index = source["message_index"];
	        this.timestamp = this.convertValues(source["timestamp"], null);
	        this.description = source["description"];
	        this.trigger_type = source["trigger_type"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CheckpointConfig {
	    auto_checkpoint_enabled: boolean;
	    checkpoint_strategy: string;
	    max_checkpoints: number;
	    checkpoint_interval: number;
	
	    static createFrom(source: any = {}) {
	        return new CheckpointConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.auto_checkpoint_enabled = source["auto_checkpoint_enabled"];
	        this.checkpoint_strategy = source["checkpoint_strategy"];
	        this.max_checkpoints = source["max_checkpoints"];
	        this.checkpoint_interval = source["checkpoint_interval"];
	    }
	}
	export class CheckpointResult {
	    checkpoint?: Checkpoint;
	    files_processed: number;
	    warnings?: string[];
	
	    static createFrom(source: any = {}) {
	        return new CheckpointResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.checkpoint = this.convertValues(source["checkpoint"], Checkpoint);
	        this.files_processed = source["files_processed"];
	        this.warnings = source["warnings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileSnapshot {
	    checkpoint_id: string;
	    file_path: string;
	    content: string;
	    hash: string;
	    is_deleted: boolean;
	    permissions?: number;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new FileSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.checkpoint_id = source["checkpoint_id"];
	        this.file_path = source["file_path"];
	        this.content = source["content"];
	        this.hash = source["hash"];
	        this.is_deleted = source["is_deleted"];
	        this.permissions = source["permissions"];
	        this.size = source["size"];
	    }
	}
	export class TimelineNode {
	    checkpoint: Checkpoint;
	    children: TimelineNode[];
	    file_snapshot_ids: string[];
	
	    static createFrom(source: any = {}) {
	        return new TimelineNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.checkpoint = this.convertValues(source["checkpoint"], Checkpoint);
	        this.children = this.convertValues(source["children"], TimelineNode);
	        this.file_snapshot_ids = source["file_snapshot_ids"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SessionTimeline {
	    session_id: string;
	    root_node?: TimelineNode;
	    current_checkpoint_id?: string;
	    total_checkpoints: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionTimeline(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.root_node = this.convertValues(source["root_node"], TimelineNode);
	        this.current_checkpoint_id = source["current_checkpoint_id"];
	        this.total_checkpoints = source["total_checkpoints"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace claude {
	
	export class ClaudeAgent {
	    name: string;
	    description: string;
	    tools?: string;
	    color?: string;
	    model?: string;
	    system_prompt: string;
	    scope: string;
	    file_path: string;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeAgent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.tools = source["tools"];
	        this.color = source["color"];
	        this.model = source["model"];
	        this.system_prompt = source["system_prompt"];
	        this.scope = source["scope"];
	        this.file_path = source["file_path"];
	    }
	}
	export class ClaudeMdFile {
	    relative_path: string;
	    absolute_path: string;
	    size: number;
	    modified: number;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeMdFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.relative_path = source["relative_path"];
	        this.absolute_path = source["absolute_path"];
	        this.size = source["size"];
	        this.modified = source["modified"];
	    }
	}
	export class Hook {
	    type: string;
	    command?: string;
	    script?: string;
	
	    static createFrom(source: any = {}) {
	        return new Hook(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.command = source["command"];
	        this.script = source["script"];
	    }
	}
	export class HookMatcher {
	    matcher: string;
	    hooks: Hook[];
	
	    static createFrom(source: any = {}) {
	        return new HookMatcher(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.matcher = source["matcher"];
	        this.hooks = this.convertValues(source["hooks"], Hook);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HooksConfig {
	    PreToolUse?: HookMatcher[];
	    PostToolUse?: HookMatcher[];
	    Notification?: HookMatcher[];
	    Stop?: HookMatcher[];
	
	    static createFrom(source: any = {}) {
	        return new HooksConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.PreToolUse = this.convertValues(source["PreToolUse"], HookMatcher);
	        this.PostToolUse = this.convertValues(source["PostToolUse"], HookMatcher);
	        this.Notification = this.convertValues(source["Notification"], HookMatcher);
	        this.Stop = this.convertValues(source["Stop"], HookMatcher);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Message {
	    parentUuid?: string;
	    isSidechain: boolean;
	    userType?: string;
	    cwd?: string;
	    sessionId?: string;
	    version?: string;
	    gitBranch?: string;
	    agentId?: string;
	    message?: Record<string, any>;
	    type: string;
	    uuid: string;
	    timestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.parentUuid = source["parentUuid"];
	        this.isSidechain = source["isSidechain"];
	        this.userType = source["userType"];
	        this.cwd = source["cwd"];
	        this.sessionId = source["sessionId"];
	        this.version = source["version"];
	        this.gitBranch = source["gitBranch"];
	        this.agentId = source["agentId"];
	        this.message = source["message"];
	        this.type = source["type"];
	        this.uuid = source["uuid"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class SessionStatus {
	    session_id: string;
	    project_path: string;
	    model: string;
	    status: string;
	    // Go type: time
	    started_at: any;
	    pid?: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.project_path = source["project_path"];
	        this.model = source["model"];
	        this.status = source["status"];
	        this.started_at = this.convertValues(source["started_at"], null);
	        this.pid = source["pid"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SlashCommand {
	    id: string;
	    command_type: string;
	    name: string;
	    full_command: string;
	    scope: string;
	    namespace?: string;
	    file_path: string;
	    content: string;
	    description?: string;
	    allowed_tools: string[];
	    argument_hint?: string;
	    has_bash_commands: boolean;
	    has_file_references: boolean;
	    accepts_arguments: boolean;
	    plugin_id?: string;
	    plugin_name?: string;
	
	    static createFrom(source: any = {}) {
	        return new SlashCommand(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.command_type = source["command_type"];
	        this.name = source["name"];
	        this.full_command = source["full_command"];
	        this.scope = source["scope"];
	        this.namespace = source["namespace"];
	        this.file_path = source["file_path"];
	        this.content = source["content"];
	        this.description = source["description"];
	        this.allowed_tools = source["allowed_tools"];
	        this.argument_hint = source["argument_hint"];
	        this.has_bash_commands = source["has_bash_commands"];
	        this.has_file_references = source["has_file_references"];
	        this.accepts_arguments = source["accepts_arguments"];
	        this.plugin_id = source["plugin_id"];
	        this.plugin_name = source["plugin_name"];
	    }
	}

}

export namespace database {
	
	export class Agent {
	    id: number;
	    name: string;
	    icon: string;
	    system_prompt: string;
	    default_task?: string;
	    model: string;
	    provider_api_id?: string;
	    hooks?: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    updated_at: any;
	
	    static createFrom(source: any = {}) {
	        return new Agent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.system_prompt = source["system_prompt"];
	        this.default_task = source["default_task"];
	        this.model = source["model"];
	        this.provider_api_id = source["provider_api_id"];
	        this.hooks = source["hooks"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AgentRun {
	    id: number;
	    agent_id: number;
	    agent_name: string;
	    agent_icon: string;
	    task: string;
	    model: string;
	    project_path: string;
	    session_id: string;
	    status: string;
	    pid?: number;
	    // Go type: time
	    process_started_at?: any;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    completed_at?: any;
	
	    static createFrom(source: any = {}) {
	        return new AgentRun(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agent_id = source["agent_id"];
	        this.agent_name = source["agent_name"];
	        this.agent_icon = source["agent_icon"];
	        this.task = source["task"];
	        this.model = source["model"];
	        this.project_path = source["project_path"];
	        this.session_id = source["session_id"];
	        this.status = source["status"];
	        this.pid = source["pid"];
	        this.process_started_at = this.convertValues(source["process_started_at"], null);
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.completed_at = this.convertValues(source["completed_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorkspaceIndex {
	    name: string;
	    added_at: number;
	    providers: ProviderInfo[];
	    last_provider: string;
	    branch?: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceIndex(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.added_at = source["added_at"];
	        this.providers = this.convertValues(source["providers"], ProviderInfo);
	        this.last_provider = source["last_provider"];
	        this.branch = source["branch"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProviderInfo {
	    id: string;
	    provider_id: string;
	    path: string;
	    provider_api_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.provider_id = source["provider_id"];
	        this.path = source["path"];
	        this.provider_api_id = source["provider_api_id"];
	    }
	}
	export class ProjectIndex {
	    name: string;
	    added_at: number;
	    last_accessed: number;
	    description?: string;
	    available: boolean;
	    providers: ProviderInfo[];
	    workspaces: WorkspaceIndex[];
	    last_provider: string;
	    project_type?: string;
	    has_git_support?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProjectIndex(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.added_at = source["added_at"];
	        this.last_accessed = source["last_accessed"];
	        this.description = source["description"];
	        this.available = source["available"];
	        this.providers = this.convertValues(source["providers"], ProviderInfo);
	        this.workspaces = this.convertValues(source["workspaces"], WorkspaceIndex);
	        this.last_provider = source["last_provider"];
	        this.project_type = source["project_type"];
	        this.has_git_support = source["has_git_support"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProviderApiConfig {
	    id: string;
	    name: string;
	    provider_id: string;
	    base_url?: string;
	    auth_token?: string;
	    is_default: boolean;
	    is_builtin: boolean;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    updated_at: any;
	
	    static createFrom(source: any = {}) {
	        return new ProviderApiConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.provider_id = source["provider_id"];
	        this.base_url = source["base_url"];
	        this.auth_token = source["auth_token"];
	        this.is_default = source["is_default"];
	        this.is_builtin = source["is_builtin"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TableData {
	    data: any[];
	    total: number;
	    page: number;
	    page_size: number;
	
	    static createFrom(source: any = {}) {
	        return new TableData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.total = source["total"];
	        this.page = source["page"];
	        this.page_size = source["page_size"];
	    }
	}

}

export namespace git {
	
	export class FileStatus {
	    Path: string;
	    Status: string;
	
	    static createFrom(source: any = {}) {
	        return new FileStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Path = source["Path"];
	        this.Status = source["Status"];
	    }
	}

}

export namespace main {
	
	export class Action {
	    id: string;
	    name: string;
	    description?: string;
	    command: string;
	    icon?: string;
	    scope: string;
	
	    static createFrom(source: any = {}) {
	        return new Action(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.command = source["command"];
	        this.icon = source["icon"];
	        this.scope = source["scope"];
	    }
	}
	export class ActionsResult {
	    global_actions: Action[];
	    project_actions: Action[];
	    workspace_actions: Action[];
	
	    static createFrom(source: any = {}) {
	        return new ActionsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.global_actions = this.convertValues(source["global_actions"], Action);
	        this.project_actions = this.convertValues(source["project_actions"], Action);
	        this.workspace_actions = this.convertValues(source["workspace_actions"], Action);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ClaudeAgentEntry {
	    name: string;
	    path: string;
	    is_directory: boolean;
	    size: number;
	    extension?: string;
	    entry_type: string;
	    icon?: string;
	    color?: string;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeAgentEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.is_directory = source["is_directory"];
	        this.size = source["size"];
	        this.extension = source["extension"];
	        this.entry_type = source["entry_type"];
	        this.icon = source["icon"];
	        this.color = source["color"];
	    }
	}
	export class ClaudeInstallation {
	    path: string;
	    version?: string;
	    source: string;
	    installation_type: string;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeInstallation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.version = source["version"];
	        this.source = source["source"];
	        this.installation_type = source["installation_type"];
	    }
	}
	export class ClaudeVersionInfo {
	    is_installed: boolean;
	    version?: string;
	    output: string;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeVersionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.is_installed = source["is_installed"];
	        this.version = source["version"];
	        this.output = source["output"];
	    }
	}
	export class CloneRepositoryResult {
	    id: string;
	    path: string;
	    sessions: string[];
	    created_at: number;
	
	    static createFrom(source: any = {}) {
	        return new CloneRepositoryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.sessions = source["sessions"];
	        this.created_at = source["created_at"];
	    }
	}
	export class CommandResult {
	    success: boolean;
	    output: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new CommandResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.output = source["output"];
	        this.error = source["error"];
	    }
	}
	export class DayStat {
	    date: string;
	    total_tokens: number;
	    models_used: string[];
	    total_cost: number;
	
	    static createFrom(source: any = {}) {
	        return new DayStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.total_tokens = source["total_tokens"];
	        this.models_used = source["models_used"];
	        this.total_cost = source["total_cost"];
	    }
	}
	export class FileEntry {
	    name: string;
	    path: string;
	    is_directory: boolean;
	    size: number;
	    extension?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.is_directory = source["is_directory"];
	        this.size = source["size"];
	        this.extension = source["extension"];
	    }
	}
	export class GitRepoStatus {
	    branch: string;
	    modified: git.FileStatus[];
	    staged: git.FileStatus[];
	    untracked: git.FileStatus[];
	    is_clean: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GitRepoStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.branch = source["branch"];
	        this.modified = this.convertValues(source["modified"], git.FileStatus);
	        this.staged = this.convertValues(source["staged"], git.FileStatus);
	        this.untracked = this.convertValues(source["untracked"], git.FileStatus);
	        this.is_clean = source["is_clean"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HookValidationResult {
	    valid: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new HookValidationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.valid = source["valid"];
	        this.message = source["message"];
	    }
	}
	export class MCPAddResult {
	    name: string;
	    success: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new MCPAddResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.success = source["success"];
	        this.message = source["message"];
	    }
	}
	export class MCPImportResult {
	    success: boolean;
	    imported_count: number;
	    failed_count: number;
	    messages: string[];
	
	    static createFrom(source: any = {}) {
	        return new MCPImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.imported_count = source["imported_count"];
	        this.failed_count = source["failed_count"];
	        this.messages = source["messages"];
	    }
	}
	export class MCPProjectConfig {
	    servers: Record<string, mcp.MCPServerConfig>;
	
	    static createFrom(source: any = {}) {
	        return new MCPProjectConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.servers = this.convertValues(source["servers"], mcp.MCPServerConfig, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ModelStat {
	    model: string;
	    total_tokens: number;
	    total_input_tokens: number;
	    total_output_tokens: number;
	    total_cache_creation_tokens: number;
	    total_cache_read_tokens: number;
	    session_count: number;
	    total_cost: number;
	    input_tokens: number;
	    output_tokens: number;
	    cache_creation_tokens: number;
	    cache_read_tokens: number;
	
	    static createFrom(source: any = {}) {
	        return new ModelStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.total_tokens = source["total_tokens"];
	        this.total_input_tokens = source["total_input_tokens"];
	        this.total_output_tokens = source["total_output_tokens"];
	        this.total_cache_creation_tokens = source["total_cache_creation_tokens"];
	        this.total_cache_read_tokens = source["total_cache_read_tokens"];
	        this.session_count = source["session_count"];
	        this.total_cost = source["total_cost"];
	        this.input_tokens = source["input_tokens"];
	        this.output_tokens = source["output_tokens"];
	        this.cache_creation_tokens = source["cache_creation_tokens"];
	        this.cache_read_tokens = source["cache_read_tokens"];
	    }
	}
	export class ProcessInfo {
	    key: string;
	    pid: number;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProcessInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.pid = source["pid"];
	        this.running = source["running"];
	    }
	}
	export class ProjectStat {
	    project_path: string;
	    project_name: string;
	    total_cost: number;
	    total_tokens: number;
	    session_count: number;
	    last_used: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.project_path = source["project_path"];
	        this.project_name = source["project_name"];
	        this.total_cost = source["total_cost"];
	        this.total_tokens = source["total_tokens"];
	        this.session_count = source["session_count"];
	        this.last_used = source["last_used"];
	    }
	}
	export class ProviderSession {
	    id: string;
	    project_id: string;
	    project_path: string;
	    created_at: number;
	    message_timestamp?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.project_path = source["project_path"];
	        this.created_at = source["created_at"];
	        this.message_timestamp = source["message_timestamp"];
	    }
	}
	export class PtySessionInfo {
	    session_id: string;
	    cwd: string;
	    shell: string;
	    rows: number;
	    cols: number;
	
	    static createFrom(source: any = {}) {
	        return new PtySessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.cwd = source["cwd"];
	        this.shell = source["shell"];
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	    }
	}
	export class Skill {
	    id: string;
	    name: string;
	    full_name: string;
	    scope: string;
	    content: string;
	    description?: string;
	    path: string;
	    plugin_id?: string;
	    plugin_name?: string;
	    allowed_tools: string[];
	
	    static createFrom(source: any = {}) {
	        return new Skill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.full_name = source["full_name"];
	        this.scope = source["scope"];
	        this.content = source["content"];
	        this.description = source["description"];
	        this.path = source["path"];
	        this.plugin_id = source["plugin_id"];
	        this.plugin_name = source["plugin_name"];
	        this.allowed_tools = source["allowed_tools"];
	    }
	}
	export class UsageStats {
	    total_tokens: number;
	    total_input_tokens: number;
	    total_output_tokens: number;
	    total_sessions: number;
	    total_cache_creation_tokens: number;
	    total_cache_read_tokens: number;
	    total_cost: number;
	    by_model: ModelStat[];
	    by_day: DayStat[];
	    by_date: DayStat[];
	    by_project: ProjectStat[];
	
	    static createFrom(source: any = {}) {
	        return new UsageStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_tokens = source["total_tokens"];
	        this.total_input_tokens = source["total_input_tokens"];
	        this.total_output_tokens = source["total_output_tokens"];
	        this.total_sessions = source["total_sessions"];
	        this.total_cache_creation_tokens = source["total_cache_creation_tokens"];
	        this.total_cache_read_tokens = source["total_cache_read_tokens"];
	        this.total_cost = source["total_cost"];
	        this.by_model = this.convertValues(source["by_model"], ModelStat);
	        this.by_day = this.convertValues(source["by_day"], DayStat);
	        this.by_date = this.convertValues(source["by_date"], DayStat);
	        this.by_project = this.convertValues(source["by_project"], ProjectStat);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorktreeInfo {
	    current_path: string;
	    root_path: string;
	    main_branch: string;
	    is_worktree: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WorktreeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current_path = source["current_path"];
	        this.root_path = source["root_path"];
	        this.main_branch = source["main_branch"];
	        this.is_worktree = source["is_worktree"];
	    }
	}

}

export namespace mcp {
	
	export class MCPServerStatus {
	    running: boolean;
	    error?: string;
	    last_checked?: number;
	
	    static createFrom(source: any = {}) {
	        return new MCPServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.error = source["error"];
	        this.last_checked = source["last_checked"];
	    }
	}
	export class MCPServer {
	    name: string;
	    transport: string;
	    command?: string;
	    args?: string[];
	    env?: Record<string, string>;
	    url?: string;
	    scope: string;
	    is_active: boolean;
	    status: MCPServerStatus;
	
	    static createFrom(source: any = {}) {
	        return new MCPServer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.transport = source["transport"];
	        this.command = source["command"];
	        this.args = source["args"];
	        this.env = source["env"];
	        this.url = source["url"];
	        this.scope = source["scope"];
	        this.is_active = source["is_active"];
	        this.status = this.convertValues(source["status"], MCPServerStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MCPServerConfig {
	    command?: string;
	    args?: string[];
	    env?: Record<string, string>;
	    url?: string;
	
	    static createFrom(source: any = {}) {
	        return new MCPServerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.args = source["args"];
	        this.env = source["env"];
	        this.url = source["url"];
	    }
	}

}

export namespace plugin {
	
	export class PluginAuthor {
	    name: string;
	    email?: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginAuthor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	    }
	}
	export class PluginMetadata {
	    name: string;
	    version: string;
	    description: string;
	    author: PluginAuthor;
	    homepage?: string;
	    repository?: string;
	    license?: string;
	    keywords?: string[];
	
	    static createFrom(source: any = {}) {
	        return new PluginMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.author = this.convertValues(source["author"], PluginAuthor);
	        this.homepage = source["homepage"];
	        this.repository = source["repository"];
	        this.license = source["license"];
	        this.keywords = source["keywords"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Plugin {
	    id: string;
	    metadata: PluginMetadata;
	    install_path: string;
	    enabled: boolean;
	    installed_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Plugin(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.metadata = this.convertValues(source["metadata"], PluginMetadata);
	        this.install_path = source["install_path"];
	        this.enabled = source["enabled"];
	        this.installed_at = source["installed_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PluginAgent {
	    plugin_id: string;
	    plugin_name: string;
	    name: string;
	    description: string;
	    tools?: string;
	    color?: string;
	    model?: string;
	    instructions: string;
	    file_path: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginAgent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin_id = source["plugin_id"];
	        this.plugin_name = source["plugin_name"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.tools = source["tools"];
	        this.color = source["color"];
	        this.model = source["model"];
	        this.instructions = source["instructions"];
	        this.file_path = source["file_path"];
	    }
	}
	
	export class PluginCommand {
	    plugin_id: string;
	    plugin_name: string;
	    name: string;
	    description?: string;
	    allowed_tools?: string[];
	    content: string;
	    file_path: string;
	    full_command: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginCommand(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin_id = source["plugin_id"];
	        this.plugin_name = source["plugin_name"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.allowed_tools = source["allowed_tools"];
	        this.content = source["content"];
	        this.file_path = source["file_path"];
	        this.full_command = source["full_command"];
	    }
	}
	export class PluginHook {
	    event_type: string;
	    matcher?: string;
	    command: string;
	    plugin_id: string;
	    plugin_name: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginHook(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.event_type = source["event_type"];
	        this.matcher = source["matcher"];
	        this.command = source["command"];
	        this.plugin_id = source["plugin_id"];
	        this.plugin_name = source["plugin_name"];
	    }
	}
	export class PluginSkill {
	    plugin_id: string;
	    plugin_name: string;
	    name: string;
	    description?: string;
	    content: string;
	    folder_path: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginSkill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin_id = source["plugin_id"];
	        this.plugin_name = source["plugin_name"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.content = source["content"];
	        this.folder_path = source["folder_path"];
	    }
	}
	export class PluginContents {
	    plugin: Plugin;
	    agents: PluginAgent[];
	    commands: PluginCommand[];
	    skills: PluginSkill[];
	    hooks: PluginHook[];
	
	    static createFrom(source: any = {}) {
	        return new PluginContents(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = this.convertValues(source["plugin"], Plugin);
	        this.agents = this.convertValues(source["agents"], PluginAgent);
	        this.commands = this.convertValues(source["commands"], PluginCommand);
	        this.skills = this.convertValues(source["skills"], PluginSkill);
	        this.hooks = this.convertValues(source["hooks"], PluginHook);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	

}

export namespace ssh {
	
	export class AutoSyncStatus {
	    project_path: string;
	    is_running: boolean;
	    is_paused: boolean;
	    last_sync_time?: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AutoSyncStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.project_path = source["project_path"];
	        this.is_running = source["is_running"];
	        this.is_paused = source["is_paused"];
	        this.last_sync_time = source["last_sync_time"];
	        this.error = source["error"];
	    }
	}
	export class SshConnection {
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    key_path?: string;
	
	    static createFrom(source: any = {}) {
	        return new SshConnection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.key_path = source["key_path"];
	    }
	}

}

