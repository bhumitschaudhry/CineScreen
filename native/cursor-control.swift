#!/usr/bin/env swift

import Foundation
import CoreGraphics

// CGDisplayHideCursor and CGDisplayShowCursor are available in CoreGraphics
// They use a reference count system - each hide increments, each show decrements
// Cursor is only visible when count is 0

func hideCursor() {
    let displayID = CGMainDisplayID()
    let result = CGDisplayHideCursor(displayID)
    if result == .success {
        print("OK")
    } else {
        fputs("ERROR: CGDisplayHideCursor failed with code \(result.rawValue)\n", stderr)
        exit(1)
    }
}

func showCursor() {
    let displayID = CGMainDisplayID()
    let result = CGDisplayShowCursor(displayID)
    if result == .success {
        print("OK")
    } else {
        fputs("ERROR: CGDisplayShowCursor failed with code \(result.rawValue)\n", stderr)
        exit(1)
    }
}

// Parse command line arguments
let args = CommandLine.arguments

if args.count < 2 {
    fputs("Usage: cursor-control [hide|show]\n", stderr)
    exit(1)
}

let command = args[1].lowercased()

switch command {
case "hide":
    hideCursor()
case "show":
    showCursor()
default:
    fputs("Unknown command: \(command)\nUsage: cursor-control [hide|show]\n", stderr)
    exit(1)
}
