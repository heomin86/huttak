import AppKit
import ApplicationServices
import Carbon.HIToolbox

struct SelectedText {
    let text: String
    let rect: CGRect
}

enum SelectionReader {
    /// The offscreen protocol rejects a segment above this size. The panel says so instead of sending it.
    static let maxCharacters = 100_000

    /// Selection exposed by the accessibility tree. Safe to call while the pointer is moving.
    static func read() -> SelectedText? {
        guard AXIsProcessTrusted() else { return nil }
        if let element = focusedElement(), let selected = selection(in: element) { return selected }
        guard let app = focusedApplication() else { return nil }
        if let element = elementAttribute(app, kAXFocusedUIElementAttribute), let selected = selection(in: element) {
            return selected
        }
        if let window = elementAttribute(app, kAXFocusedWindowAttribute) {
            return search(window, remaining: 80)
        }
        return nil
    }

    /// Used for an explicit translate. Some apps, including Chrome, leave AXSelectedText empty
    /// until a copy. The previous clipboard is put back.
    static func readForCommand() -> SelectedText? {
        if secureFocused() { return nil }
        if let selected = read() { return selected }
        return copySelection()
    }

    private static func selection(in element: AXUIElement) -> SelectedText? {
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

    private static func secureFocused() -> Bool {
        guard let element = focusedElement() else { return false }
        return stringAttribute(element, kAXSubroleAttribute) == kAXSecureTextFieldSubrole
    }

    private static func search(_ element: AXUIElement, remaining: Int) -> SelectedText? {
        if remaining <= 0 { return nil }
        if let selected = selection(in: element) { return selected }
        guard let children = children(of: element) else { return nil }
        var left = remaining - 1
        for child in children.prefix(12) {
            if let found = search(child, remaining: left) { return found }
            left = max(0, left - 4)
        }
        return nil
    }

    private static func copySelection() -> SelectedText? {
        guard AXIsProcessTrusted() else { return nil }
        let pasteboard = NSPasteboard.general
        let before = pasteboard.changeCount
        let saved: [(NSPasteboard.PasteboardType, Data)] = (pasteboard.types ?? []).compactMap { type in
            guard let data = pasteboard.data(forType: type) else { return nil }
            return (type, data)
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: false)
        else { return nil }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)

        let deadline = Date().addingTimeInterval(0.35)
        while Date() < deadline && pasteboard.changeCount == before {
            Thread.sleep(forTimeInterval: 0.02)
        }
        let copied = pasteboard.changeCount == before
            ? nil
            : pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if !saved.isEmpty {
            pasteboard.clearContents()
            for (type, data) in saved {
                pasteboard.setData(data, forType: type)
            }
        }
        guard let copied, !copied.isEmpty else { return nil }
        return SelectedText(text: copied, rect: CGRect(origin: NSEvent.mouseLocation, size: .zero))
    }

    private static func focusedElement() -> AXUIElement? {
        elementAttribute(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute)
    }

    private static func focusedApplication() -> AXUIElement? {
        elementAttribute(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute)
    }

    private static func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &raw) == .success, let raw else { return nil }
        guard CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        return (raw as! AXUIElement)
    }

    private static func children(of element: AXUIElement) -> [AXUIElement]? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &raw) == .success,
              let raw
        else { return nil }
        return raw as? [AXUIElement]
    }

    private static func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &raw) == .success, let raw else { return nil }
        if let text = raw as? String { return text }
        if let text = raw as? NSAttributedString { return text.string }
        return nil
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
