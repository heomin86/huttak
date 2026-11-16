import AppKit
import ApplicationServices

struct SelectedText {
    let text: String
    let rect: CGRect
}

enum SelectionReader {
    /// The offscreen protocol rejects a segment above this size. The panel says so instead of sending it.
    static let maxCharacters = 100_000

    static func read() -> SelectedText? {
        guard let element = focusedElement() else { return nil }
        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        if pid == getpid() { return nil }
        if stringAttribute(element, kAXSubroleAttribute) == kAXSecureTextFieldSubrole { return nil }

        let raw = stringAttribute(element, kAXSelectedTextAttribute)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return nil }

        let rect: CGRect
        if let bounds = boundsForSelectedRange(element) {
            rect = usableScreenRect(bounds)
        } else {
            rect = CGRect(origin: NSEvent.mouseLocation, size: .zero)
        }
        return SelectedText(text: raw, rect: rect)
    }

    private static func focusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &raw) == .success,
              let raw
        else { return nil }
        guard CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        return (raw as! AXUIElement)
    }

    private static func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &raw) == .success else { return nil }
        return raw as? String
    }

    private static func boundsForSelectedRange(_ element: AXUIElement) -> CGRect? {
        var rawRange: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rawRange) == .success,
              let rawRange,
              let range = cfRange(rawRange)
        else { return nil }

        var stored = range
        guard let rangeValue = AXValueCreate(.cfRange, &stored) else { return nil }
        var rawBounds: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXBoundsForRangeParameterizedAttribute as CFString,
            rangeValue,
            &rawBounds
        ) == .success, let rawBounds else { return nil }
        return cgRect(rawBounds)
    }

    private static func cfRange(_ value: CFTypeRef) -> CFRange? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let ax = value as! AXValue
        guard AXValueGetType(ax) == .cfRange else { return nil }
        var range = CFRange()
        guard AXValueGetValue(ax, .cfRange, &range) else { return nil }
        return range
    }

    private static func cgRect(_ value: CFTypeRef) -> CGRect? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let ax = value as! AXValue
        guard AXValueGetType(ax) == .cgRect else { return nil }
        var rect = CGRect.zero
        guard AXValueGetValue(ax, .cgRect, &rect) else { return nil }
        return rect
    }

    /// Accessibility frames are documented as screen coordinates, but some apps report a top-left origin.
    /// Whichever form lands on a display is the one the panel uses.
    private static func usableScreenRect(_ raw: CGRect) -> CGRect {
        if onScreen(raw) { return raw }
        let top = NSScreen.screens.map(\.frame.maxY).max() ?? raw.maxY
        let flipped = CGRect(
            x: raw.origin.x,
            y: top - raw.origin.y - raw.height,
            width: raw.width,
            height: raw.height
        )
        if onScreen(flipped) { return flipped }
        return CGRect(origin: NSEvent.mouseLocation, size: .zero)
    }

    private static func onScreen(_ rect: CGRect) -> Bool {
        NSScreen.screens.contains { $0.frame.intersects(rect) }
    }
}
