// +build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

// Toggle fullscreen for the key window
void ToggleFullscreen() {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window = [[NSApplication sharedApplication] keyWindow];
        if (window != nil) {
            // Enable fullscreen support if not already enabled
            NSWindowCollectionBehavior behavior = [window collectionBehavior];
            if (!(behavior & NSWindowCollectionBehaviorFullScreenPrimary)) {
                [window setCollectionBehavior:behavior | NSWindowCollectionBehaviorFullScreenPrimary];
            }
            // Toggle fullscreen
            [window toggleFullScreen:nil];
        }
    });
}

// Check if the key window is in fullscreen mode
int IsFullscreen() {
    __block int result = 0;
    dispatch_sync(dispatch_get_main_queue(), ^{
        NSWindow *window = [[NSApplication sharedApplication] keyWindow];
        if (window != nil) {
            NSUInteger styleMask = [window styleMask];
            result = (styleMask & NSWindowStyleMaskFullScreen) != 0 ? 1 : 0;
        }
    });
    return result;
}
*/
import "C"

// ToggleNativeFullscreen toggles the macOS native fullscreen mode
func ToggleNativeFullscreen() {
	C.ToggleFullscreen()
}

// IsNativeFullscreen returns true if the window is in fullscreen mode
func IsNativeFullscreen() bool {
	return C.IsFullscreen() == 1
}
