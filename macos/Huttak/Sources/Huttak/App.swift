import AppKit
import ApplicationServices
import Carbon.HIToolbox

private let consentCopy = """
번역은 이 Mac 안의 PLaMo 3 Translate가 합니다. 선택한 글은 계정이나 번역 서버로 나가지 않습니다. 모델을 처음 받을 때만 Hugging Face에서 가중치를 받습니다.

PLaMo Community License가 적용됩니다. 개인·학술 이용은 등록 없이 가능하고, 회사 업무로 쓰는 경우에는 라이선스 조건을 확인해야 합니다.
"""

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
    private var config: LaunchConfig?
    private var trusted = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        hotkeyTarget = self
        overlay.onOffer = { [weak self] in self?.beginTranslation(consentIfNeeded: true) }
        overlay.onConsent = { [weak self] in self?.runTranslation(consent: true) }
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
    }

    func applicationWillTerminate(_ notification: Notification) {
        translator.stop()
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let hotkeyHandler { RemoveEventHandler(hotkeyHandler) }
    }

    func translateFromHotkey() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let selected = SelectionReader.read() {
                self.offeredText = selected.text
                self.anchor = selected.rect
            }
            self.beginTranslation(consentIfNeeded: true)
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
        RegisterEventHotKey(
            UInt32(kVK_ANSI_S),
            UInt32(controlKey | optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKey
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
        if now {
            installMonitors()
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
        if overlay.contains(event.locationInWindow) { return }
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
        if selected.text == offeredText && overlay.panelIsVisible {
            overlay.hideOffer()
            return
        }
        offeredText = selected.text
        anchor = selected.rect
        overlay.showOffer(near: selected.rect)
    }

    private func beginTranslation(consentIfNeeded: Bool) {
        guard trusted else {
            overlay.show(
                near: anchorOrMouse(),
                heading: "손쉬운 사용 권한이 필요합니다",
                body: "시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 Huttak을 켜 주세요. 그 권한으로 앞쪽 앱에서 선택한 글만 읽습니다.",
                busy: true,
                consent: false
            )
            promptForTrust()
            return
        }
        let text = SelectionReader.read()?.text ?? offeredText
        guard !text.isEmpty else {
            overlay.show(
                near: anchorOrMouse(),
                heading: "선택한 글이 없습니다",
                body: "번역할 글을 드래그한 뒤 ㅎ 버튼을 누르거나 ⌃⌥S를 누르세요.",
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
        overlay.show(near: anchor, heading: "번역하는 중", body: "번역을 준비하고 있습니다.", busy: true, consent: false)
        Task { @MainActor in
            do {
                let health = try await translator.health()
                if consentIfNeeded && !health.consent {
                    overlay.show(near: anchor, heading: "이 Mac 안에서 번역", body: consentCopy, busy: false, consent: true)
                    return
                }
                runTranslation(consent: health.consent)
            } catch let TranslatorClientError.failed(message) {
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: message, busy: true, consent: false)
            } catch {
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: error.localizedDescription, busy: true, consent: false)
            }
        }
    }

    private func runTranslation(consent: Bool) {
        let text = offeredText
        overlay.show(near: anchor, heading: "번역하는 중", body: "번역 모델을 준비하고 있습니다.", busy: true, consent: false)
        startPolling()
        Task { @MainActor in
            do {
                let result = try await translator.translate(text: text, consent: consent)
                stopPolling()
                let body = result.text.isEmpty ? "번역 결과가 비어 있습니다." : result.text
                overlay.show(
                    near: anchor,
                    heading: directionHeading(source: result.source, target: result.target),
                    body: body,
                    busy: false,
                    consent: false
                )
            } catch let TranslatorClientError.failed(message) {
                stopPolling()
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: message, busy: true, consent: false)
            } catch {
                stopPolling()
                overlay.show(near: anchor, heading: "번역하지 못했습니다", body: error.localizedDescription, busy: true, consent: false)
            }
        }
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
        translate.isEnabled = trusted
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

    @objc private func menuTranslate() {
        if let selected = SelectionReader.read() {
            offeredText = selected.text
            anchor = selected.rect
        }
        beginTranslation(consentIfNeeded: true)
    }

    @objc private func openSettings() {
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
