package rpc

import (
	"encoding/json"
	"fmt"
)

func ProjectChatHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"EnsureProjectChat": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.EnsureChat(argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3), argString(p, 4), argBool(p, 5))
		},
		"SendProjectChatMessage": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.SendMessage(argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3), argString(p, 4))
		},
		"SwitchProjectChatProvider": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.SwitchProvider(argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3))
		},
		"InterruptProjectChat": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return nil, d.ProjectChat.InterruptActiveSegment(argString(p, 0))
		},
		"ClearProjectChat": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.ClearChat(argString(p, 0))
		},
		"GetProjectChat": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.GetChat(argString(p, 0))
		},
		"GetActiveChatForProject": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.GetActiveChatForProject(argString(p, 0))
		},
		"ListProjectChats": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.ListChats(argString(p, 0))
		},
		"ResumeProjectChat": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.ResumeChat(argString(p, 0))
		},
		"LoadProjectChatHistory": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.LoadActiveSegmentFrames(argString(p, 0))
		},
		"LoadProjectChatAllSegmentHistory": func(p json.RawMessage) (any, error) {
			if d.ProjectChat == nil {
				return nil, errNotInitialized("project chat")
			}
			return d.ProjectChat.LoadAllSegmentFrames(argString(p, 0))
		},
	}
}

func errNotInitialized(name string) error {
	return fmt.Errorf("%s manager not initialized", name)
}
