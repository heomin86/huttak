import AppKit
import ApplicationServices
import Carbon.HIToolbox

struct SelectedText {
    let text: String
    /// Union of the original glyphs, in screen coordinates. Zero when the app gave no bounds.
    let rect: CGRect
    /// One rectangle per visual line of the selection. The cover paints their union.
    let covers: [CGRect]
    /// Font and colors the app reported for the original. Colors from the screen are added later.
    let style: CoverStyle
    /// Paragraphs and list items of a web selection, in order. Empty for plain text views.
    /// When present, `text` holds one line per block.
    var blocks: [SelectionBlock] = []
}

struct SelectionBlock {
    /// The list number or bullet the app draws itself, such as "1. ". It stays visible.
    let marker: String
    let text: String
    /// The block's text runs in screen coordinates. Its translation is drawn over their union.
    let rects: [CGRect]
}

enum SelectionReader {
    /// The offscreen protocol rejects a segment above this size. The panel says so instead of sending it.
    static let maxCharacters = 100_000

    /// Selection exposed by the accessibility tree. Safe to call while the pointer is moving.
    static func read() -> SelectedText? {
        guard AXIsProcessTrusted() else { return nil }
        // A hung app must not freeze the menu-bar app for the system's default 6 seconds.
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.5)
        if secureFocused() { return nil }
        if let app = focusedApplication() { enableWebAccessibility(app) }
        if let element = focusedElement(), let selected = selection(in: element) { return selected }
        guard let app = focusedApplication() else { return nil }
        if let element = elementAttribute(app, kAXFocusedUIElementAttribute), let selected = selection(in: element) {
            return selected
        }
        if let window = elementAttribute(app, kAXFocusedWindowAttribute) {
            if let found = search(window, remaining: 80) { return found }
            // Electron apps often report no focused element after a mouse selection in
            // read-only content. The document's own selection is on its web area.
            if let web = webArea(in: window), let selected = markerSelection(around: web) {
                return selected
            }
        }
        return nil
    }

    private static func webArea(in root: AXUIElement) -> AXUIElement? {
        var queue: [(AXUIElement, Int)] = [(root, 0)]
        var visited = 0
        while !queue.isEmpty, visited < 600 {
            let (element, depth) = queue.removeFirst()
            visited += 1
            if stringAttribute(element, kAXRoleAttribute) == "AXWebArea" { return element }
            guard depth < 14 else { continue }
            for child in children(of: element) ?? [] {
                queue.append((child, depth + 1))
            }
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
        let raw = stringAttribute(element, kAXSelectedTextAttribute) ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return markerSelection(around: element) }
        let range = selectedRange(element)
        var covers = lineRects(element, text: raw, range: range)
        covers = covers.filter { $0.width > 1 && $0.height > 1 }
        if covers.isEmpty, let web = markerSelection(around: element, fallbackText: trimmed), !web.covers.isEmpty {
            return web
        }
        let style = range.flatMap { rangeStyle(element, range: $0) } ?? CoverStyle()
        return make(text: trimmed, covers: covers, style: style)
    }

    private static func make(
        text: String,
        covers: [CGRect],
        style: CoverStyle = CoverStyle(),
        blocks: [SelectionBlock] = []
    ) -> SelectedText {
        let usable = covers.filter { $0.width > 1 && $0.height > 1 }
        let union = usable.dropFirst().reduce(usable.first ?? .zero) { $0.union($1) }
        let anchor = usable.isEmpty ? CGRect(origin: NSEvent.mouseLocation, size: .zero) : union
        // Line breaks between blocks are what keep paragraphs and list items apart in the
        // translation; web views report the selection as one run-on string.
        let joined = blocks.isEmpty ? text.replacingOccurrences(of: "\u{FFFC}", with: "") : blocks.map { $0.marker + $0.text }.joined(separator: "\n")
        return SelectedText(text: joined, rect: anchor, covers: usable, style: style, blocks: blocks)
    }

    // MARK: Web views (Chrome, Safari, Electron)

    private static var webAccessibilityPids = Set<pid_t>()

    /// Chromium and Electron build their accessibility tree only after a client asks for it.
    /// Without this, Chrome reports no selected text and no selection bounds.
    private static func enableWebAccessibility(_ app: AXUIElement) {
        var pid: pid_t = 0
        AXUIElementGetPid(app, &pid)
        guard pid != getpid(), webAccessibilityPids.insert(pid).inserted else { return }
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    }

    /// Web content reports its selection as a text-marker range instead of a character range.
    /// The focused element is often a child of the web area, so the parents are tried as well.
    private static func markerSelection(around element: AXUIElement, fallbackText: String = "") -> SelectedText? {
        var current: AXUIElement? = element
        for _ in 0..<12 {
            guard let node = current else { break }
            if let markers = rawAttribute(node, "AXSelectedTextMarkerRange") {
                let read = (parameterized(node, "AXStringForTextMarkerRange", markers))
                    .flatMap { ($0 as? String) ?? ($0 as? NSAttributedString)?.string }?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let text = read.isEmpty ? fallbackText : read
                if !text.isEmpty {
                    let attributed = parameterized(node, "AXAttributedStringForTextMarkerRange", markers) as? NSAttributedString
                    let found = markerCovers(node, markers: markers, text: text)
                    return make(
                        text: text,
                        covers: found.covers,
                        style: attributed.map(style(from:)) ?? CoverStyle(),
                        blocks: found.blocks
                    )
                }
            }
            current = elementAttribute(node, kAXParentAttribute)
        }
        return nil
    }

    /// Chromium's bounds for a marker range are unreliable: a range that ends at a paragraph
    /// boundary stretches to the bottom of the view. The text runs inside that area are used
    /// instead: every run whose text is part of the selection is covered, grouped by the
    /// paragraph or list item it belongs to.
    private static func markerCovers(
        _ node: AXUIElement,
        markers: CFTypeRef,
        text: String
    ) -> (covers: [CGRect], blocks: [SelectionBlock]) {
        guard let raw = parameterized(node, "AXBoundsForTextMarkerRange", markers).flatMap(cgRect),
              raw.width > 1, raw.height > 1
        else { return ([], []) }
        struct Run {
            let owner: AXUIElement
            let marker: String
            let value: String
            let frame: CGRect
            /// A line break sits before this run inside the same paragraph.
            let breakBefore: Bool
        }
        var runs: [Run] = []
        var pendingBreak = false
        var budget = 3000
        func visit(_ element: AXUIElement, depth: Int, owner: AXUIElement, marker: String) {
            guard budget > 0, depth < 40 else { return }
            budget -= 1
            let frame = frameOf(element)
            if let frame, !frame.intersects(raw) { return }
            let role = stringAttribute(element, kAXRoleAttribute) ?? ""
            if role == kAXStaticTextRole {
                let value = stringAttribute(element, kAXValueAttribute) ?? ""
                if normalized(value).isEmpty {
                    if value.contains("\n") { pendingBreak = true }
                    return
                }
                guard let frame, frame.width > 1, frame.height > 1 else { return }
                runs.append(Run(owner: owner, marker: marker, value: value, frame: frame, breakBefore: pendingBreak))
                pendingBreak = false
                return
            }
            // A group that is only styling (bold, italic, a link) stays inside its paragraph.
            let subrole = stringAttribute(element, kAXSubroleAttribute) ?? ""
            let inline = subrole.hasSuffix("StyleGroup") || role == "AXLink"
            let isBlock = role == kAXGroupRole && !inline
            let kids = children(of: element) ?? []
            var childMarker = isBlock ? "" : marker
            if isBlock, let first = kids.first, stringAttribute(first, kAXRoleAttribute) == "AXListMarker" {
                childMarker = stringAttribute(first, kAXValueAttribute) ?? ""
            }
            for child in kids {
                visit(child, depth: depth + 1, owner: isBlock ? element : owner, marker: childMarker)
            }
        }
        // The focused element can be one message while the selection spans several.
        let root = webAreaAncestor(of: node) ?? node
        visit(root, depth: 0, owner: root, marker: "")

        guard let touched = SelectionRuns.touched(selection: text, runs: runs.map(\.value)) else {
            return ([], [])
        }
        // A selection inside one run keeps its own bounds, so the rest of the paragraph stays.
        if touched.count == 1, normalized(runs[touched[0]].value) != normalized(text) {
            let run = runs[touched[0]]
            if normalized(run.value).contains(normalized(text)), raw.height <= run.frame.height + 4 {
                let screen = screenRect(raw)
                return (screen.width > 1 && screen.height > 1 ? [screen] : [], [])
            }
        }
        // Blocks are whole: a paragraph that is partly selected is translated whole, because
        // its cover hides all of it.
        var included = Set(touched)
        var first = touched[0]
        while first > 0, CFEqual(runs[first - 1].owner, runs[first].owner), !runs[first].breakBefore {
            first -= 1
            included.insert(first)
        }
        var last = touched[touched.count - 1]
        while last + 1 < runs.count, CFEqual(runs[last + 1].owner, runs[last].owner), !runs[last + 1].breakBefore {
            last += 1
            included.insert(last)
        }
        var grouped: [(owner: AXUIElement, marker: String, text: String, rects: [CGRect])] = []
        for run in included.sorted().map({ runs[$0] }) {
            if let last = grouped.last, CFEqual(last.owner, run.owner), !run.breakBefore {
                grouped[grouped.count - 1].text += run.value
                grouped[grouped.count - 1].rects.append(run.frame)
            } else {
                let continues = grouped.last.map { CFEqual($0.owner, run.owner) } ?? false
                grouped.append((run.owner, continues ? "" : run.marker, run.value, [run.frame]))
            }
        }
        let converted: [SelectionBlock] = grouped.compactMap { block in
            let rects = block.rects.map(screenRect).filter { $0.width > 1 && $0.height > 1 }
            let body = normalized(block.text)
            guard !rects.isEmpty, !body.isEmpty else { return nil }
            return SelectionBlock(marker: block.marker, text: body, rects: rects)
        }
        return (converted.flatMap(\.rects), converted)
    }

    private static func webAreaAncestor(of element: AXUIElement) -> AXUIElement? {
        var current: AXUIElement? = element
        for _ in 0..<40 {
            guard let node = current else { return nil }
            if stringAttribute(node, kAXRoleAttribute) == "AXWebArea" { return node }
            current = elementAttribute(node, kAXParentAttribute)
        }
        return nil
    }

    private static func normalized(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func frameOf(_ element: AXUIElement) -> CGRect? {
        guard let position = rawAttribute(element, kAXPositionAttribute),
              let size = rawAttribute(element, kAXSizeAttribute),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
        else { return nil }
        var point = CGPoint.zero
        var extent = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
              AXValueGetValue(size as! AXValue, .cgSize, &extent)
        else { return nil }
        return CGRect(origin: point, size: extent)
    }

    private static func rawAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &raw) == .success else { return nil }
        return raw
    }

    private static func parameterized(_ element: AXUIElement, _ name: String, _ parameter: CFTypeRef) -> CFTypeRef? {
        var raw: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(element, name as CFString, parameter, &raw) == .success
        else { return nil }
        return raw
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
        if pasteboard.changeCount != before {
            pasteboard.clearContents()
            for (type, data) in saved {
                pasteboard.setData(data, forType: type)
            }
        }
        guard let copied, !copied.isEmpty else { return nil }
        if let web = focusedElement().flatMap({ markerSelection(around: $0, fallbackText: copied) }), !web.covers.isEmpty {
            return web
        }
        return make(text: copied, covers: [])
    }

    /// Line rectangles for the selected range. A multi-line selection is several bounds,
    /// matching the lines the extension would replace inside one block.
    private static func lineRects(_ element: AXUIElement, text: String, range: CFRange?) -> [CGRect] {
        guard let range else {
            return boundsForSelectedRange(element).map { [screenRect($0)] } ?? []
        }
        let ns = text as NSString
        var rects: [CGRect] = []
        var start = 0
        while start < ns.length {
            let line = ns.lineRange(for: NSRange(location: start, length: 0))
            if line.length == 0 { break }
            var length = line.length
            let chunk = ns.substring(with: line)
            if chunk.hasSuffix("\r\n") {
                length -= 2
            } else if chunk.hasSuffix("\n") || chunk.hasSuffix("\r") {
                length -= 1
            }
            if length > 0 {
                let piece = CFRange(location: range.location + line.location, length: length)
                if let raw = bounds(element, range: piece) {
                    let screen = screenRect(raw)
                    if screen.width > 1, screen.height > 1 {
                        rects.append(screen)
                    }
                }
            }
            start = line.location + line.length
        }
        if !rects.isEmpty { return rects }
        if let whole = bounds(element, range: range) {
            let screen = screenRect(whole)
            if screen.width > 1, screen.height > 1 { return [screen] }
        }
        return boundsForSelectedRange(element).map { [screenRect($0)] } ?? []
    }

    private static func selectedRange(_ element: AXUIElement) -> CFRange? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &raw) == .success,
              let raw
        else { return nil }
        return cfRange(raw)
    }

    private static func rangeStyle(_ element: AXUIElement, range: CFRange) -> CoverStyle? {
        var stored = range
        guard let rangeValue = AXValueCreate(.cfRange, &stored),
              let attributed = parameterized(element, kAXAttributedStringForRangeParameterizedAttribute, rangeValue)
                as? NSAttributedString
        else { return nil }
        return style(from: attributed)
    }

    /// Accessibility attributed strings carry the font as an `AXFont` dictionary and the color
    /// as `AXForegroundColor`. Apps fill in as much as they know; Chromium gives only the size.
    static func style(from attributed: NSAttributedString) -> CoverStyle {
        var style = CoverStyle()
        guard attributed.length > 0 else { return style }
        let attributes = attributed.attributes(at: 0, effectiveRange: nil)
        if let font = attributes[.font] as? NSFont {
            style.fontName = font.fontName
            style.fontSize = font.pointSize
        }
        if let font = attributes[NSAttributedString.Key("AXFont")] as? [String: Any] {
            if let size = (font["AXFontSize"] as? NSNumber)?.doubleValue, size > 0 { style.fontSize = size }
            if let name = font["AXFontName"] as? String, !name.isEmpty { style.fontName = name }
        }
        if let raw = attributes[NSAttributedString.Key("AXForegroundColor")],
           CFGetTypeID(raw as CFTypeRef) == CGColor.typeID,
           let color = NSColor(cgColor: raw as! CGColor) {
            style.foreground = color
        }
        return style
    }

    private static func focusedElement() -> AXUIElement? {
        elementAttribute(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute)
    }

    /// The system-wide focused application is sometimes missing for Electron apps; the
    /// frontmost process is the same app.
    private static func focusedApplication() -> AXUIElement? {
        if let app = elementAttribute(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute) { return app }
        guard let front = NSWorkspace.shared.frontmostApplication else { return nil }
        return AXUIElementCreateApplication(front.processIdentifier)
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

    private static func bounds(_ element: AXUIElement, range: CFRange) -> CGRect? {
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

    /// Accessibility bounds use Quartz global coordinates: origin at the top-left of the
    /// main display, y growing down. AppKit windows use a bottom-left origin, so the rect is
    /// flipped against the main display's height. A rect that lands on no display is dropped.
    private static func screenRect(_ raw: CGRect) -> CGRect {
        guard let main = NSScreen.screens.first else { return .zero }
        let flipped = CGRect(
            x: raw.origin.x,
            y: main.frame.maxY - raw.origin.y - raw.height,
            width: raw.width,
            height: raw.height
        )
        return onScreen(flipped) ? flipped : .zero
    }

    private static func onScreen(_ rect: CGRect) -> Bool {
        NSScreen.screens.contains { $0.frame.intersects(rect) }
    }
}
