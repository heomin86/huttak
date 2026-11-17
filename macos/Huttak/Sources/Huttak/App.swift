import AppKit
import ApplicationServices
import Carbon.HIToolbox

private let consentCopy = """
번역은 이 Mac 안의 PLaMo 3 Translate가 합니다. 선택한 글은 계정이나 번역 서버로 나가지 않습니다. 모델을 처음 받을 때만 Hugging Face에서 가중치를 받습니다.

PLaMo Community License가 적용됩니다. 개인·학술 이용은 등록 없이 가능하고, 회사 업무로 쓰는 경우에는 라이선스 조건을 확인해야 합니다.
"""

private let permissionCopy = """
Huttak이 앞쪽 앱에서 선택한 글만 읽으려면 손쉬운 사용을 켜야 합니다. 암호 필드는 읽지 않습니다.

시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용(macOS 최신 버전에서는 기기 제어 및 데이터 접근)에서 Huttak을 켜 주세요. 목록에 없으면 Finder에서 Huttak.app을 그 목록으로 끌어다 놓습니다.

권한을 켜면 글을 드래그할 때 옆에 ㅎ이 뜨고, ⌃⌥S로도 번역합니다.
"""

enum HuttakLog {
    static func write(_ message: String) {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Huttak", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("huttak.log")
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }
}

private var hotkeyTarget: AppDelegate?

private func hotkeyPressed(
    _: EventHandlerCallRef?,
    _: EventRef?,
    _: UnsafeMutableRawPointer?
) -> OSStatus {
    hotkeyTarget?.translateFromHotkey()
    return noErr
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let overlay = TranslationOverlay()
    private let cover = InPlaceCover()
    private let translator = TranslatorService()
    private var statusItem: NSStatusItem?
    private var hotKey: EventHotKeyRef?
    private var hotkeyHandler: EventHandlerRef?
    private var mouseMonitor: Any?
    private var keyMonitor: Any?
    private var offerTimer: Timer?
    private var trustTimer: Timer?
    private var pollTimer: Timer?
    private var offeredText = ""
    private var anchor = CGRect.zero
    private var coverRects: [CGRect] = []
    private var coverStyle = CoverStyle()
    private var coverBlocks: [SelectionBlock] = []
    private var config: LaunchConfig?
    private var trusted = false
    private var explainingPermission = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        hotkeyTarget = self
        overlay.onOffer = { [weak self] in self?.beginTranslation(consentIfNeeded: true) }
        overlay.onConsent = { [weak self] in self?.runTranslation(consent: true) }
        overlay.onSecondary = { [weak self] in self?.openSettings() }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "ㅎ"
        statusItem?.button?.toolTip = "Huttak 선택 번역"
        rebuildMenu()
        loadConfig()
        registerHotkey()
        promptForTrust()
        trustTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshTrust()
        }
        refreshTrust()
        if !trusted { presentPermission() }
        HuttakLog.write("launch trusted=\(trusted)")
    }

    func applicationWillTerminate(_ notification: Notification) {
        translator.stop()
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let hotkeyHandler { RemoveEventHandler(hotkeyHandler) }
    }

    func translateFromHotkey() {
        DispatchQueue.main.async { [weak self] in
            self?.beginTranslation(consentIfNeeded: true)
        }
    }

    private func loadConfig() {
        guard let url = Bundle.main.url(forResource: "launch", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(LaunchConfig.self, from: data)
        else {
            overlay.show(
                near: defaultAnchor(),
                heading: "실행 방법이 다릅니다",
                body: "이 앱은 macos/run.sh로 실행합니다. 그 스크립트가 번역 엔진의 위치를 넣어 줍니다.",
                busy: true,
                consent: false
            )
            return
        }
        self.config = config
        do {
            try translator.start(config)
        } catch let TranslatorClientError.failed(message) {
            overlay.show(near: defaultAnchor(), heading: "번역 준비 실패", body: message, busy: true, consent: false)
        } catch {
            overlay.show(
                near: defaultAnchor(),
                heading: "번역 준비 실패",
                body: error.localizedDescription,
                busy: true,
                consent: false
            )
        }
    }

    private func registerHotkey() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        InstallEventHandler(
            GetApplicationEventTarget(),
            hotkeyPressed,
            1,
            &eventType,
            nil,
            &hotkeyHandler
        )
        let hotKeyID = EventHotKeyID(signature: OSType(0x4854_414B), id: 1)
        let status = RegisterEventHotKey(
            UInt32(kVK_ANSI_S),
            UInt32(controlKey | optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKey
        )
        HuttakLog.write("hotkey status=\(status)")
    }

    private func presentPermission() {
        explainingPermission = true
        overlay.show(
            near: noticeAnchor(),
            heading: "손쉬운 사용 권한이 필요합니다",
            body: permissionCopy,
            busy: false,
            consent: false,
            actionTitle: "설정 열기",
            activate: true
        )
    }

    private func promptForTrust() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    private func refreshTrust() {
        let now = AXIsProcessTrusted()
        if now == trusted { return }
        trusted = now
        rebuildMenu()
        HuttakLog.write("accessibility \(now)")
        if now {
            installMonitors()
            if explainingPermission {
                explainingPermission = false
                overlay.show(
                    near: noticeAnchor(),
                    heading: "권한을 확인했습니다",
                    body: "글을 드래그한 뒤 ㅎ 또는 ⌃⌥S를 누르면, 번역이 원래 글자 위를 덮습니다.",
                    busy: false,
                    consent: false,
                    activate: true
                )
            }
        }
    }

    private func installMonitors() {
        guard mouseMonitor == nil else { return }
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp]) { [weak self] event in
            self?.scheduleOffer(event)
        }
        keyMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyUp]) { [weak self] event in
            self?.scheduleOffer(event)
        }
    }

    private func scheduleOffer(_ event: NSEvent) {
        if event.keyCode == 53 {
            cover.hide()
            return
        }
        if cover.contains(event.locationInWindow) || overlay.contains(event.locationInWindow) { return }
        if cover.isVisible, event.type == .leftMouseUp {
            cover.hide()
        }
        offerTimer?.invalidate()
        offerTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: false) { [weak self] _ in
            self?.offerSelection()
        }
    }

    private func offerSelection() {
        guard trusted else { return }
        guard let selected = SelectionReader.read() else {
            if !overlay.panelIsVisible { overlay.hideOffer() }
            return
        }
        if selected.text == offeredText && (overlay.panelIsVisible || cover.isVisible) {
            overlay.hideOffer()
            return
        }
        if selected.text != offeredText {
            cover.hide()
        }
        offeredText = selected.text
        anchor = selected.rect
        coverRects = selected.covers
        coverStyle = selected.style
        coverBlocks = selected.blocks
        overlay.showOffer(near: selected.rect)
    }

    private func beginTranslation(consentIfNeeded: Bool) {
        guard trusted else {
            HuttakLog.write("translate blocked: accessibility off")
            presentPermission()
            promptForTrust()
            return
        }
        if let selected = SelectionReader.readForCommand() {
            offeredText = selected.text
            anchor = selected.rect
            coverRects = selected.covers
            coverStyle = selected.style
            coverBlocks = selected.blocks
        }
        let text = offeredText
        HuttakLog.write("translate chars=\(text.count)")
        guard !text.isEmpty else {
            overlay.show(
                near: anchorOrMouse(),
                heading: "선택한 글이 없습니다",
                body: "번역할 글을 드래그한 뒤 옆에 뜨는 ㅎ을 누르거나 ⌃⌥S를 누르세요. 글을 읽지 못하면 그 앱이 선택 영역을 알려 주지 않는 경우입니다.",
                busy: true,
                consent: false
            )
            return
        }
        if text.count > SelectionReader.maxCharacters {
            overlay.show(
                near: anchor,
                heading: "글이 너무 깁니다",
                body: "한 번에 10만 자까지 번역합니다.",
                busy: true,
                consent: false
            )
            return
        }
        offeredText = text
        let rects = coverRects
        let base = coverStyle
        Task { @MainActor in
            // Colors are read from the screen while the original is still visible.
            self.coverStyle = await CoverSampler.sample(rects: rects, into: base)
            self.showPending()
            do {
                let health = try await translator.health()
                if consentIfNeeded && !health.consent {
                    cover.hide()
                    overlay.show(
                        near: noticeAnchor(),
                        heading: "이 Mac 안에서 번역",
                        body: consentCopy,
                        busy: false,
                        consent: true,
                        activate: true
                    )
                    return
                }
                runTranslation(consent: health.consent)
            } catch let TranslatorClientError.failed(message) {
                cover.hide()
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: message, busy: true, consent: false)
            } catch {
                cover.hide()
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: error.localizedDescription, busy: true, consent: false)
            }
        }
    }

    private func runTranslation(consent: Bool) {
        let text = offeredText
        showPending()
        startPolling()
        Task { @MainActor in
            do {
                let result = try await translator.translate(text: text, consent: consent)
                stopPolling()
                let body = result.text.isEmpty ? "번역 결과가 비어 있습니다." : result.text
                showResult(body)
            } catch let TranslatorClientError.failed(message) {
                stopPolling()
                cover.hide()
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: message, busy: true, consent: false)
            } catch {
                stopPolling()
                cover.hide()
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: error.localizedDescription, busy: true, consent: false)
            }
        }
    }

    /// Covers the original glyphs while the model runs. A side card is only used when
    /// the front app did not report selection bounds.
    private func showPending() {
        if !coverRects.isEmpty {
            overlay.hideOffer()
            cover.show(rects: coverRects, style: coverStyle, text: "…")
            return
        }
        overlay.show(near: anchor, heading: "번역하는 중", body: "번역을 준비하고 있습니다.", busy: true, consent: false)
    }

    /// Pairs each translated line with the block it came from. The translator keeps one line
    /// per block and repeats the list marker, which the app already draws, so it is dropped.
    private func blockTranslations(_ text: String) -> [(rects: [CGRect], text: String)]? {
        guard coverBlocks.count > 1 else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        guard lines.count == coverBlocks.count else { return nil }
        return zip(coverBlocks, lines).map { block, line in
            let marker = block.marker.trimmingCharacters(in: .whitespaces)
            var body = line.trimmingCharacters(in: .whitespaces)
            if !marker.isEmpty, body.hasPrefix(marker) {
                body = String(body.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
            }
            return (block.rects, body)
        }
    }

    private func showResult(_ text: String) {
        if !coverRects.isEmpty {
            overlay.hide()
            if let placed = blockTranslations(text) {
                cover.showBlocks(placed, style: coverStyle)
            } else {
                cover.show(rects: coverRects, style: coverStyle, text: text)
            }
            return
        }
        overlay.show(
            near: anchor,
            heading: "번역",
            body: text,
            busy: false,
            consent: false
        )
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                guard self.pollTimer != nil else { return }
                guard let health = try? await self.translator.health() else { return }
                guard self.pollTimer != nil else { return }
                var message = health.message
                if health.state == "downloading", health.total > 0 {
                    let percent = Int((Double(health.received) / Double(health.total) * 100).rounded())
                    message = "\(health.message) \(percent)%"
                }
                if !self.coverRects.isEmpty {
                    if health.state == "downloading" || health.state == "loading" {
                        self.cover.show(rects: self.coverRects, style: self.coverStyle, text: message)
                    }
                    return
                }
                self.overlay.show(near: self.anchor, heading: "번역하는 중", body: message, busy: true, consent: false)
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let translate = NSMenuItem(title: "선택한 글 번역    ⌃⌥S", action: #selector(menuTranslate), keyEquivalent: "")
        translate.target = self
        menu.addItem(translate)
        if !trusted {
            let note = NSMenuItem(title: "손쉬운 사용 권한이 필요합니다", action: nil, keyEquivalent: "")
            note.isEnabled = false
            menu.addItem(note)
        }
        let settings = NSMenuItem(title: "손쉬운 사용 설정…", action: #selector(openSettings), keyEquivalent: "")
        settings.target = self
        menu.addItem(settings)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "종료", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem?.menu = menu
    }

    private func anchorOrMouse() -> CGRect {
        if anchor.width > 0 || anchor.height > 0 || anchor.origin != .zero { return anchor }
        return defaultAnchor()
    }

    private func defaultAnchor() -> CGRect {
        let mouse = NSEvent.mouseLocation
        return CGRect(origin: mouse, size: .zero)
    }

    private func noticeAnchor() -> CGRect {
        let visible = NSScreen.main?.visibleFrame ?? CGRect(x: 80, y: 80, width: 800, height: 600)
        return CGRect(x: visible.maxX - 24, y: visible.maxY - 24, width: 1, height: 1)
    }

    @objc private func menuTranslate() {
        beginTranslation(consentIfNeeded: true)
    }

    @objc private func openSettings() {
        promptForTrust()
        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
        let urls = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ]
        for raw in urls {
            if let url = URL(string: raw), NSWorkspace.shared.open(url) { return }
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

@main
enum HuttakMain {
    static func main() {
        let appDelegate = AppDelegate()
        let application = NSApplication.shared
        application.delegate = appDelegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
