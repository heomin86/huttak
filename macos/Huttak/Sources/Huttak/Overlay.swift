import AppKit

final class TranslationOverlay: NSObject {
    var onOffer: (() -> Void)?
    var onConsent: (() -> Void)?
    var onCopy: (() -> Void)?

    private let offerPanel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 32, height: 32),
        styleMask: [.borderless, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    private let resultPanel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 360, height: 230),
        styleMask: [.titled, .closable, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    private let heading = NSTextField(labelWithString: "")
    private let body = NSTextView()
    private let copyButton = NSButton(title: "복사", target: nil, action: nil)
    private let consentButton = NSButton(title: "동의하고 번역", target: nil, action: nil)

    override init() {
        super.init()
        configureOffer()
        configureResult()
    }

    var offerIsVisible: Bool { offerPanel.isVisible }
    var panelIsVisible: Bool { resultPanel.isVisible }

    func contains(_ point: NSPoint) -> Bool {
        offerPanel.frame.contains(point) || resultPanel.frame.contains(point)
    }

    func showOffer(near rect: CGRect) {
        place(offerPanel, near: rect, size: offerPanel.frame.size)
        offerPanel.orderFrontRegardless()
    }

    func hideOffer() {
        offerPanel.orderOut(nil)
    }

    func show(near rect: CGRect, heading: String, body: String, busy: Bool, consent: Bool) {
        self.heading.stringValue = heading
        self.body.string = body
        copyButton.isEnabled = !busy && !consent && !body.isEmpty
        copyButton.title = "복사"
        consentButton.isHidden = !consent
        hideOffer()
        place(resultPanel, near: rect, size: resultPanel.frame.size)
        resultPanel.orderFrontRegardless()
    }

    func hide() {
        resultPanel.orderOut(nil)
        offerPanel.orderOut(nil)
    }

    private func configureOffer() {
        prepare(offerPanel)
        offerPanel.isOpaque = false
        offerPanel.backgroundColor = .clear
        let button = NSButton(title: "ㅎ", target: self, action: #selector(offerClicked))
        button.bezelStyle = .circular
        button.font = .systemFont(ofSize: 16, weight: .bold)
        button.toolTip = "선택한 글 번역"
        button.frame = NSRect(x: 0, y: 0, width: 32, height: 32)
        button.wantsLayer = true
        button.layer?.backgroundColor = NSColor(srgbRed: 0.93, green: 0.42, blue: 0.12, alpha: 1).cgColor
        button.layer?.cornerRadius = 16
        button.contentTintColor = .white
        offerPanel.contentView = button
    }

    private func configureResult() {
        prepare(resultPanel)
        resultPanel.title = "Huttak"
        resultPanel.isFloatingPanel = true

        heading.font = .systemFont(ofSize: 12, weight: .semibold)
        heading.textColor = .secondaryLabelColor
        heading.translatesAutoresizingMaskIntoConstraints = false

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        body.isEditable = false
        body.isSelectable = true
        body.drawsBackground = false
        body.font = .systemFont(ofSize: 15)
        body.textContainerInset = NSSize(width: 2, height: 4)
        body.isVerticallyResizable = true
        body.isHorizontallyResizable = false
        body.textContainer?.widthTracksTextView = true
        scroll.documentView = body

        copyButton.target = self
        copyButton.action = #selector(copyClicked)
        copyButton.bezelStyle = .rounded
        copyButton.translatesAutoresizingMaskIntoConstraints = false
        consentButton.target = self
        consentButton.action = #selector(consentClicked)
        consentButton.bezelStyle = .rounded
        consentButton.keyEquivalent = "\r"
        consentButton.translatesAutoresizingMaskIntoConstraints = false

        guard let content = resultPanel.contentView else { return }
        content.addSubview(heading)
        content.addSubview(scroll)
        content.addSubview(copyButton)
        content.addSubview(consentButton)

        NSLayoutConstraint.activate([
            heading.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            heading.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            heading.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            scroll.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 6),
            scroll.bottomAnchor.constraint(equalTo: copyButton.topAnchor, constant: -8),
            copyButton.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            copyButton.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -12),
            consentButton.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            consentButton.centerYAnchor.constraint(equalTo: copyButton.centerYAnchor),
        ])
    }

    private func prepare(_ panel: NSPanel) {
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
    }

    private func place(_ panel: NSPanel, near rect: CGRect, size: NSSize) {
        var origin = NSPoint(x: rect.maxX + 8, y: rect.midY - size.height / 2)
        let screen = NSScreen.screens.first { $0.frame.intersects(rect) } ?? NSScreen.main
        if let visible = screen?.visibleFrame {
            if origin.x + size.width > visible.maxX {
                origin.x = max(visible.minX, rect.minX - size.width - 8)
            }
            if origin.y < visible.minY { origin.y = visible.minY + 8 }
            if origin.y + size.height > visible.maxY { origin.y = visible.maxY - size.height - 8 }
        }
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
    }

    @objc private func offerClicked() {
        onOffer?()
    }

    @objc private func consentClicked() {
        onConsent?()
    }

    @objc private func copyClicked() {
        let text = body.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
        copyButton.title = "복사함"
        onCopy?()
    }
}

func directionHeading(source: String?, target: String) -> String {
    func name(_ code: String) -> String {
        switch code {
        case "en": "영어"
        case "ko": "한국어"
        case "ja": "일본어"
        case "zh-hans": "중국어"
        case "zh-hant": "중국어"
        default: code
        }
    }
    let from = source.map(name) ?? "선택한 글"
    return "\(from) → \(name(target))"
}
