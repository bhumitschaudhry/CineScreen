#!/usr/bin/env swift

import Foundation
import AppKit
import CoreGraphics

// Initialize NSApplication to ensure AppKit cursors are available
// This is needed for NSCursor static properties to work in CLI mode
let _ = NSApplication.shared

// Private CoreGraphics functions for system-wide cursor detection
@_silgen_name("CGSCurrentCursorSeed")
func CGSCurrentCursorSeed() -> Int

@_silgen_name("CGSGetGlobalCursorDataSize")
func CGSGetGlobalCursorDataSize(_ connection: Int32, _ size: UnsafeMutablePointer<Int32>) -> Int32

@_silgen_name("CGSGetGlobalCursorData")
func CGSGetGlobalCursorData(_ connection: Int32, _ data: UnsafeMutableRawPointer, _ size: UnsafeMutablePointer<Int32>, _ rowBytes: UnsafeMutablePointer<Int32>, _ rect: UnsafeMutablePointer<CGRect>, _ hotSpot: UnsafeMutablePointer<CGPoint>, _ depth: UnsafeMutablePointer<Int32>, _ components: UnsafeMutablePointer<Int32>, _ bitsPerComponent: UnsafeMutablePointer<Int32>) -> Int32

@_silgen_name("CGSMainConnectionID")
func CGSMainConnectionID() -> Int32

// Debug mode - set via environment variable
let debugMode = ProcessInfo.processInfo.environment["DEBUG"] != nil

// Helper to get cursor signature (hotspot + size)
func getCursorSignature(_ cursor: NSCursor) -> (hotspotX: Double, hotspotY: Double, width: Double, height: Double) {
    let hotspot = cursor.hotSpot
    let size = cursor.image.size
    return (Double(hotspot.x), Double(hotspot.y), Double(size.width), Double(size.height))
}

// Check if two cursor signatures match (with tolerance)
func signaturesMatch(
    _ sig1: (hotspotX: Double, hotspotY: Double, width: Double, height: Double),
    _ sig2: (hotspotX: Double, hotspotY: Double, width: Double, height: Double),
    tolerance: Double = 0.5
) -> Bool {
    return abs(sig1.hotspotX - sig2.hotspotX) <= tolerance &&
           abs(sig1.hotspotY - sig2.hotspotY) <= tolerance &&
           abs(sig1.width - sig2.width) <= tolerance &&
           abs(sig1.height - sig2.height) <= tolerance
}

// Get the current system cursor type using NSCursor.currentSystem
func getCurrentCursorType() -> String {
    // Use NSCursor.currentSystem to get the actual system cursor
    guard let currentCursor = NSCursor.currentSystem else {
        if debugMode {
            fputs("DEBUG: NSCursor.currentSystem returned nil, defaulting to arrow\n", stderr)
        }
        return "arrow"
    }

    let currentSig = getCursorSignature(currentCursor)

    if debugMode {
        fputs("DEBUG: Current cursor - hotspot=(\(currentSig.hotspotX), \(currentSig.hotspotY)) size=(\(currentSig.width), \(currentSig.height))\n", stderr)
        let iBeamSig = getCursorSignature(NSCursor.iBeam)
        fputs("DEBUG: iBeam signature - hotspot=(\(iBeamSig.hotspotX), \(iBeamSig.hotspotY)) size=(\(iBeamSig.width), \(iBeamSig.height))\n", stderr)
    }

    // Check against standard system cursors by comparing signatures
    // Order matters - check more specific cursors first

    if signaturesMatch(currentSig, getCursorSignature(NSCursor.iBeam)) {
        return "ibeam"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.iBeamCursorForVerticalLayout)) {
        return "ibeamvertical"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.pointingHand)) {
        return "pointer"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.openHand)) {
        return "hand"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.closedHand)) {
        return "closedhand"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.crosshair)) {
        return "crosshair"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeLeftRight)) {
        return "resizeleftright"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeUpDown)) {
        return "resizeupdown"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeLeft)) {
        return "resizeleft"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeRight)) {
        return "resizeright"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeUp)) {
        return "resizeup"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeDown)) {
        return "resizedown"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.operationNotAllowed)) {
        return "notallowed"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.dragCopy)) {
        return "copy"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.dragLink)) {
        return "draglink"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.contextualMenu)) {
        return "contextmenu"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.disappearingItem)) {
        return "poof"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.arrow)) {
        return "arrow"
    }

    // Default to arrow for unrecognized cursors (custom cursors from apps)
    if debugMode {
        fputs("DEBUG: Unrecognized cursor (possibly custom), defaulting to arrow\n", stderr)
    }
    return "arrow"
}

// Get mouse button states
func getMouseButtonStates() -> (left: Bool, right: Bool, middle: Bool) {
    let left = CGEventSource.buttonState(.combinedSessionState, button: .left)
    let right = CGEventSource.buttonState(.combinedSessionState, button: .right)
    let middle = CGEventSource.buttonState(.combinedSessionState, button: .center)
    return (left, right, middle)
}

// Get mouse position
func getMousePosition() -> CGPoint {
    return NSEvent.mouseLocation
}

// Get main screen height for coordinate conversion
func getMainScreenHeight() -> CGFloat {
    return NSScreen.main?.frame.height ?? 0
}

// Check for streaming mode via command line argument
let streamingMode = CommandLine.arguments.contains("--stream")
let streamInterval: UInt32 = 4000 // 4ms = 250Hz sample rate

func outputTelemetry() {
    let cursorType = getCurrentCursorType()
    let buttons = getMouseButtonStates()
    let position = getMousePosition()
    let screenHeight = getMainScreenHeight()

    // Convert from macOS coordinates (origin at bottom-left) to standard coordinates (origin at top-left)
    let adjustedY = screenHeight - position.y

    // Output as JSON for easy parsing
    let output: [String: Any] = [
        "cursor": cursorType,
        "buttons": [
            "left": buttons.left,
            "right": buttons.right,
            "middle": buttons.middle
        ],
        "position": [
            "x": Int(position.x),
            "y": Int(adjustedY)
        ]
    ]

    if let jsonData = try? JSONSerialization.data(withJSONObject: output, options: []),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        fflush(stdout)
    }
}

if streamingMode {
    // Streaming mode: continuously output telemetry at high frequency
    // Read from stdin to know when to stop (parent process closes pipe)
    while true {
        outputTelemetry()
        usleep(streamInterval)
    }
} else {
    // Single-shot mode: output once and exit (backwards compatible)
    outputTelemetry()
}
