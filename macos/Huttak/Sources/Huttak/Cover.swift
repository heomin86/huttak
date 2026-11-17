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

    func show(rects: [CGRect], fontSize: CGFloat, text: String) {
        hide()
        let usable = rects.filter { $0.width > 2 && $0.height > 2 }
        guard let first = usable.first else { return }
        let union = usable.dropFirst().reduce(first) { $0.union($1) }
        let frame = union.insetBy(dx: -3, dy: -2)
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
        panel.backgroundColor = .textBackgroundColor
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true

        let field = NSTextField(wrappingLabelWithString: text)
        field.frame = NSRect(x: 3, y: 1, width: max(1, frame.width - 6), height: max(1, frame.height - 2))
        field.font = NSFont.systemFont(ofSize: fittedSize(text: text, box: field.frame.size, preferred: fontSize))
        field.textColor = .labelColor
        field.backgroundColor = .textBackgroundColor
        field.drawsBackground = true
        field.isBezeled = false
        field.isEditable = false
        field.isSelectable = true
        field.lineBreakMode = .byWordWrapping
        field.maximumNumberOfLines = 0
        panel.contentView = field
        panels = [panel]
        panel.orderFrontRegardless()
    }

    func hide() {
        for panel in panels {
            panel.orderOut(nil)
        }
        panels.removeAll()
    }

    /// Shrinks from the source size until the translation fits the original rectangle.
    static func fittedSize(text: String, box: CGSize, preferred: CGFloat) -> CGFloat {
        let start = preferred > 4 ? preferred : max(13, min(box.height * 0.72, 22))
        var point = start
        let floor: CGFloat = 8
        let limit = CGSize(width: max(1, box.width), height: CGFloat.greatestFiniteMagnitude)
        while point > floor {
            let font = NSFont.systemFont(ofSize: point)
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

    private func fittedSize(text: String, box: CGSize, preferred: CGFloat) -> CGFloat {
        Self.fittedSize(text: text, box: box, preferred: preferred)
    }
}
