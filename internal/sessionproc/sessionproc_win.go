//go:build windows

package sessionproc

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type jobInfo struct {
	handle syscall.Handle
}

var jobs sync.Map

const (
	jobObjectExtendedLimitInformationClass = 9
	jobObjectLimitKillOnJobClose           = 0x00002000
	processSetQuota                        = 0x0100
	processTerminate                       = 0x0001
	terminateJobExitCode                   = 1
)

type ioCounters struct {
	readOperationCount  uint64
	writeOperationCount uint64
	otherOperationCount uint64
	readTransferCount   uint64
	writeTransferCount  uint64
	otherTransferCount  uint64
}

type jobObjectBasicLimitInformation struct {
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

type jobObjectExtendedLimitInformation struct {
	basicLimitInformation jobObjectBasicLimitInformation
	ioInfo                ioCounters
	processMemoryLimit    uintptr
	jobMemoryLimit        uintptr
	peakProcessMemoryUsed uintptr
	peakJobMemoryUsed     uintptr
}

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32.NewProc("TerminateJobObject")
	procGenerateConsoleCtrlEvent = kernel32.NewProc("GenerateConsoleCtrlEvent")
)

func configure(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	return nil
}

func register(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}

	job, err := createKillOnCloseJob()
	if err != nil {
		return
	}

	processHandle, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = syscall.CloseHandle(job)
		return
	}
	defer syscall.CloseHandle(processHandle)

	if err := assignProcessToJob(job, processHandle); err != nil {
		_ = syscall.CloseHandle(job)
		return
	}

	jobs.Store(cmd, jobInfo{handle: job})
}

func terminate(cmd *exec.Cmd, done <-chan struct{}, timeout time.Duration) error {
	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("no running process")
	}

	_ = generateConsoleCtrlEvent(syscall.CTRL_BREAK_EVENT, uint32(cmd.Process.Pid))

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-done:
		cleanup(cmd)
		return nil
	case <-timer.C:
		return kill(cmd)
	}
}

func kill(cmd *exec.Cmd) error {
	if value, ok := jobs.Load(cmd); ok {
		info := value.(jobInfo)
		err := terminateJobObject(info.handle, terminateJobExitCode)
		cleanup(cmd)
		return err
	}
	return cmd.Process.Kill()
}

func cleanup(cmd *exec.Cmd) {
	if value, ok := jobs.LoadAndDelete(cmd); ok {
		_ = syscall.CloseHandle(value.(jobInfo).handle)
	}
}

func createKillOnCloseJob() (syscall.Handle, error) {
	handle, _, err := procCreateJobObjectW.Call(0, 0)
	if handle == 0 {
		return 0, err
	}

	info := jobObjectExtendedLimitInformation{}
	info.basicLimitInformation.limitFlags = jobObjectLimitKillOnJobClose

	if err := setInformationJobObject(syscall.Handle(handle), &info); err != nil {
		_ = syscall.CloseHandle(syscall.Handle(handle))
		return 0, err
	}

	return syscall.Handle(handle), nil
}

func setInformationJobObject(handle syscall.Handle, info *jobObjectExtendedLimitInformation) error {
	ret, _, err := procSetInformationJobObject.Call(
		uintptr(handle),
		uintptr(jobObjectExtendedLimitInformationClass),
		uintptr(unsafe.Pointer(info)),
		unsafe.Sizeof(*info),
	)
	if ret == 0 {
		return err
	}
	return nil
}

func assignProcessToJob(job syscall.Handle, process syscall.Handle) error {
	ret, _, err := procAssignProcessToJobObject.Call(uintptr(job), uintptr(process))
	if ret == 0 {
		return err
	}
	return nil
}

func terminateJobObject(job syscall.Handle, exitCode uint32) error {
	ret, _, err := procTerminateJobObject.Call(uintptr(job), uintptr(exitCode))
	if ret == 0 {
		return err
	}
	return nil
}

func generateConsoleCtrlEvent(event uint32, processGroupID uint32) error {
	ret, _, err := procGenerateConsoleCtrlEvent.Call(uintptr(event), uintptr(processGroupID))
	if ret == 0 {
		return err
	}
	return nil
}
