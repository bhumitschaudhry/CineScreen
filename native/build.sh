#!/bin/bash

# Build script for native binaries
# This compiles the Swift scripts into standalone binaries

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Build mouse-telemetry binary (combines cursor type, button state, and position)
SWIFT_FILE="$SCRIPT_DIR/mouse-telemetry.swift"
OUTPUT_FILE="$SCRIPT_DIR/mouse-telemetry"

swiftc -o "$OUTPUT_FILE" "$SWIFT_FILE" -framework AppKit -framework CoreGraphics

if [ $? -eq 0 ]; then
    echo "Successfully built mouse-telemetry binary"
    chmod +x "$OUTPUT_FILE"
else
    echo "Failed to build mouse-telemetry binary"
    exit 1
fi

# Build cursor-control binary (hide/show system cursor)
CURSOR_SWIFT_FILE="$SCRIPT_DIR/cursor-control.swift"
CURSOR_OUTPUT_FILE="$SCRIPT_DIR/cursor-control"

swiftc -o "$CURSOR_OUTPUT_FILE" "$CURSOR_SWIFT_FILE" -framework CoreGraphics

if [ $? -eq 0 ]; then
    echo "Successfully built cursor-control binary"
    chmod +x "$CURSOR_OUTPUT_FILE"
else
    echo "Failed to build cursor-control binary"
    exit 1
fi
