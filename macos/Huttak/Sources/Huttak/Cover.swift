import AppKit

/// An opaque patch laid over the original glyphs. The extension rewrites the page's own
/// text nodes; other Mac apps do not allow that, so the translation is drawn in the
/// selection's own rectangle and the original is covered.
final class InPlaceCover: NSObject {
    private var panels: [NSPanel] = []

    var isVisible: Bool { panels.contains { $0.isVisible } }

    func contains(_ point: NSPoint) -> Bool {
        panels.contains { $0.isVisible && $0.frame.contains(point) }
    }

    func show(rects: [CGRect], style: CoverStyle, text: String) {
        showBlocks([(rects, text)], style: style)
    }

    /// One patch per paragraph or list item, each over its own original, so the layout and the
    /// app's own list numbers stay where they were.
    func showBlocks(_ blocks: [(rects: [CGRect], text: String)], style: CoverStyle) {
        hide()
        panels = blocks.compactMap { makePanel(rects: $0.rects, style: style, text: $0.text) }
        for panel in panels {
            panel.orderFrontRegardless()
        }
    }

    private func makePanel(rects: [CGRect], style: CoverStyle, text: String) -> NSPanel? {
        let usable = rects.filter { $0.width > 2 && $0.height > 2 }
        guard let first = usable.first else { return nil }
        let union = usable.dropFirst().reduce(first) { $0.union($1) }
        // A point of overlap hides the antialiased edge of the original glyphs.
        let frame = union.insetBy(dx: -2, dy: -2)
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = true
        panel.hasShadow = false
        panel.backgroundColor = style.background
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true

        let box = NSRect(x: 2, y: 1, width: max(1, frame.width - 4), height: max(1, frame.height - 3))
        let field = NSTextField(wrappingLabelWithString: text)
        // Measured with the label's own layout, so a longer translation shrinks instead of
        // being cut off at the bottom.
        var size = style.fontSize > 4 ? style.fontSize : max(13, min(box.height * 0.72, 22))
        while size > 8 {
            field.font = style.font(size: size)
            let needed = field.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: box.width, height: .greatestFiniteMagnitude)).height ?? 0
            if ceil(needed) + 2 <= box.height { break }
            size -= 0.5
        }
        field.font = style.font(size: size)
        field.textColor = style.foreground
        field.backgroundColor = style.background
        field.drawsBackground = true
        field.isBezeled = false
        field.isBordered = false
        field.isEditable = false
        field.isSelectable = true
        field.lineBreakMode = .byWordWrapping
        field.maximumNumberOfLines = 0
        field.cell?.wraps = true
        // Top-aligned like the original: the label is only as tall as its text.
        let needed = ceil(field.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: box.width, height: .greatestFiniteMagnitude)).height ?? box.height)
        let height = min(box.height, needed + 4)
        field.frame = NSRect(x: box.minX, y: box.maxY - height, width: box.width, height: height)
        let container = NSView(frame: NSRect(origin: .zero, size: frame.size))
        container.wantsLayer = true
        container.layer?.backgroundColor = style.background.cgColor
        container.addSubview(field)
        panel.contentView = container
        return panel
    }

    func hide() {
        for panel in panels {
            panel.orderOut(nil)
        }
        panels.removeAll()
    }

    /// Shrinks from the source size until the translation fits the original rectangle.
    static func fittedSize(text: String, box: CGSize, preferred: CGFloat, style: CoverStyle = CoverStyle()) -> CGFloat {
        let start = preferred > 4 ? preferred : max(13, min(box.height * 0.72, 22))
        var point = start
        let floor: CGFloat = 8
        let limit = CGSize(width: max(1, box.width), height: CGFloat.greatestFiniteMagnitude)
        while point > floor {
            let font = style.font(size: point)
            let measured = (text as NSString).boundingRect(
                with: limit,
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: [.font: font]
            )
            if measured.height <= box.height + 1 {
                return point
            }
            point -= 0.5
        }
        return floor
    }

    private func fittedSize(text: String, box: CGSize, preferred: CGFloat, style: CoverStyle) -> CGFloat {
        Self.fittedSize(text: text, box: box, preferred: preferred, style: style)
    }
}
