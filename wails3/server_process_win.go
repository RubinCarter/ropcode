//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type serverJobInfo struct {
	handle syscall.Handle
}

var serverJobs sync.Map

const (
	serverJobObjectExtendedLimitInformationClass = 9
	serverJobObjectLimitKillOnJobClose           = 0x00002000
	serverProcessSetQuota                        = 0x0100
	serverProcessTerminate                       = 0x0001
	serverTerminateJobExitCode                   = 1
)

type serverIOCounters struct {
	readOperationCount  uint64
	writeOperationCount uint64
	otherOperationCount uint64
	readTransferCount   uint64
	writeTransferCount  uint64
	otherTransferCount  uint64
}

type serverJobObjectBasicLimitInformation struct {
	perProcessUserTimeLimit int64
	perJobUserTimeLimit     int64
	limitFlags              uint32
	minimumWorkingSetSize   uintptr
	maximumWorkingSetSize   uintptr
	activeProcessLimit      uint32
	affinity                uintptr
	priorityClass           uint32
	schedulingClass         uint32
}

type serverJobObjectExtendedLimitInformation struct {
	basicLimitInformation serverJobObjectBasicLimitInformation
	ioInfo                serverIOCounters
	processMemoryLimit    uintptr
	jobMemoryLimit        uintptr
	peakProcessMemoryUsed uintptr
	peakJobMemoryUsed     uintptr
}

var (
	serverKernel32                     = syscall.NewLazyDLL("kernel32.dll")
	serverProcCreateJobObjectW         = serverKernel32.NewProc("CreateJobObjectW")
	serverProcSetInformationJobObject  = serverKernel32.NewProc("SetInformationJobObject")
	serverProcAssignProcessToJobObject = serverKernel32.NewProc("AssignProcessToJobObject")
	serverProcTerminateJobObject       = serverKernel32.NewProc("TerminateJobObject")
	serverProcGenerateConsoleCtrlEvent = serverKernel32.NewProc("GenerateConsoleCtrlEvent")
)

func configureServerProcessPlatform(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	return nil
}

func registerServerProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("server process is not started")
	}

	job, err := createServerKillOnCloseJob()
	if err != nil {
		return err
	}

	processHandle, err := syscall.OpenProcess(serverProcessSetQuota|serverProcessTerminate, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = syscall.CloseHandle(job)
		return err
	}
	defer syscall.CloseHandle(processHandle)

	if err := assignServerProcessToJob(job, processHandle); err != nil {
		_ = syscall.CloseHandle(job)
		return err
	}

	serverJobs.Store(cmd, serverJobInfo{handle: job})
	return nil
}

func terminateServerProcessPlatform(cmd *exec.Cmd, done <-chan struct{}, timeout time.Duration) error {
	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("no running process")
	}

	_ = generateServerConsoleCtrlEvent(syscall.CTRL_BREAK_EVENT, uint32(cmd.Process.Pid))

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-done:
		cleanupServerProcessPlatform(cmd)
		return nil
	case <-timer.C:
		return killServerProcessPlatform(cmd)
	}
}

func killServerProcessPlatform(cmd *exec.Cmd) error {
	if value, ok := serverJobs.Load(cmd); ok {
		info := value.(serverJobInfo)
		err := terminateServerJobObject(info.handle, serverTerminateJobExitCode)
		cleanupServerProcessPlatform(cmd)
		return err
	}
	return cmd.Process.Kill()
}

func cleanupServerProcessPlatform(cmd *exec.Cmd) {
	if value, ok := serverJobs.LoadAndDelete(cmd); ok {
		_ = syscall.CloseHandle(value.(serverJobInfo).handle)
	}
}

func createServerKillOnCloseJob() (syscall.Handle, error) {
	handle, _, err := serverProcCreateJobObjectW.Call(0, 0)
	if handle == 0 {
		return 0, err
	}

	info := serverJobObjectExtendedLimitInformation{}
	info.basicLimitInformation.limitFlags = serverJobObjectLimitKillOnJobClose
	if err := setServerInformationJobObject(syscall.Handle(handle), &info); err != nil {
		_ = syscall.CloseHandle(syscall.Handle(handle))
		return 0, err
	}

	return syscall.Handle(handle), nil
}

func setServerInformationJobObject(handle syscall.Handle, info *serverJobObjectExtendedLimitInformation) error {
	ret, _, err := serverProcSetInformationJobObject.Call(
		uintptr(handle),
		uintptr(serverJobObjectExtendedLimitInformationClass),
		uintptr(unsafe.Pointer(info)),
		unsafe.Sizeof(*info),
	)
	if ret == 0 {
		return err
	}
	return nil
}

func assignServerProcessToJob(job syscall.Handle, process syscall.Handle) error {
	ret, _, err := serverProcAssignProcessToJobObject.Call(uintptr(job), uintptr(process))
	if ret == 0 {
		return err
	}
	return nil
}

func terminateServerJobObject(job syscall.Handle, exitCode uint32) error {
	ret, _, err := serverProcTerminateJobObject.Call(uintptr(job), uintptr(exitCode))
	if ret == 0 {
		return err
	}
	return nil
}

func generateServerConsoleCtrlEvent(event uint32, processGroupID uint32) error {
	ret, _, err := serverProcGenerateConsoleCtrlEvent.Call(uintptr(event), uintptr(processGroupID))
	if ret == 0 {
		return err
	}
	return nil
}
