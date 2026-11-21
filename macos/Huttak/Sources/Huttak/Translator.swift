import AppKit
import Foundation

struct LaunchConfig: Decodable {
    let repo: String
    let node: String
    let llamaServer: String
    let translator: String
}

struct TranslatorHealth: Decodable {
    let state: String
    let message: String
    let consent: Bool
    let received: Int
    let total: Int
}

struct TranslatorPayload: Decodable {
    let text: String
    let source: String?
    let target: String
    let engine: String
}

struct TranslatorFailure: Decodable {
    let error: String
    let message: String
}

enum TranslatorClientError: Error {
    case notRunning
    case failed(String)
}

final class TranslatorService {
    private let session: URLSession
    private let lock = NSLock()
    private var process: Process?
    private var baseURL: URL?
    private var stdout = ""
    private var stderr = ""

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 600
        configuration.timeoutIntervalForResource = 600
        session = URLSession(configuration: configuration)
    }

    func start(_ config: LaunchConfig) throws {
        if process?.isRunning == true, baseURL != nil { return }
        guard FileManager.default.isExecutableFile(atPath: config.node) else {
            throw TranslatorClientError.failed("Node.js를 찾지 못했습니다. macos/run.sh로 다시 실행해 주세요.")
        }
        guard FileManager.default.fileExists(atPath: config.translator) else {
            throw TranslatorClientError.failed("번역 엔진 묶음이 없습니다. macos/run.sh로 다시 실행해 주세요.")
        }
        stopStaleTranslators()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: config.node)
        process.arguments = [config.translator]
        process.currentDirectoryURL = URL(fileURLWithPath: config.repo, isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        if !config.llamaServer.isEmpty {
            environment["HUTTAK_LLAMA_SERVER"] = config.llamaServer
        }
        process.environment = environment

        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.append(handle.availableData, to: \.stdout)
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.append(handle.availableData, to: \.stderr)
        }
        try process.run()
        self.process = process

        let deadline = Date().addingTimeInterval(15)
        var listened = ""
        while Date() < deadline {
            listened = outputSnapshot()
            if process.isRunning == false { break }
            if listened.contains("huttak-translator listening") { break }
            Thread.sleep(forTimeInterval: 0.05)
        }
        if listened.isEmpty { listened = outputSnapshot() }
        guard let port = listeningPort(in: listened) else {
            let detail = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw TranslatorClientError.failed(detail.isEmpty ? "번역 준비를 시작하지 못했습니다." : detail)
        }
        baseURL = URL(string: "http://127.0.0.1:\(port)")
    }

    func health() async throws -> TranslatorHealth {
        let data = try await request(path: "/health", method: "GET", body: nil)
        return try JSONDecoder().decode(TranslatorHealth.self, from: data)
    }

    /// `keepLines` is set when each line is a block on screen and must come back as one line.
    func translate(text: String, consent: Bool, keepLines: Bool) async throws -> TranslatorPayload {
        let body = try JSONSerialization.data(withJSONObject: ["text": text, "consent": consent, "keepLines": keepLines])
        let data = try await request(path: "/v1/translate", method: "POST", body: body)
        return try JSONDecoder().decode(TranslatorPayload.self, from: data)
    }

    func stop() {
        process?.terminate()
        process = nil
    }

    /// A previous Huttak that was killed left its translator running and holding the port.
    private func stopStaleTranslators() {
        let listing = Process()
        listing.executableURL = URL(fileURLWithPath: "/bin/ps")
        listing.arguments = ["-ax", "-o", "pid=,command="]
        let pipe = Pipe()
        listing.standardOutput = pipe
        do { try listing.run() } catch { return }
        // Drain stdout before waiting: a long process list can fill the pipe and
        // leave ps waiting for a reader while the app waits for ps to exit.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        listing.waitUntilExit()
        let text = String(data: data, encoding: .utf8) ?? ""
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard let space = trimmed.firstIndex(of: " ") else { continue }
            let command = trimmed[trimmed.index(after: space)...].trimmingCharacters(in: .whitespaces)
            guard command.contains("translator.mjs"), let pid = Int32(trimmed[..<space]) else { continue }
            kill(pid, SIGTERM)
        }
    }

    private func append(_ data: Data, to keyPath: ReferenceWritableKeyPath<TranslatorService, String>) {
        guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
        lock.lock()
        self[keyPath: keyPath] = String((self[keyPath: keyPath] + text).suffix(4000))
        lock.unlock()
    }

    private func outputSnapshot() -> String {
        lock.lock()
        defer { lock.unlock() }
        return stdout
    }

    private func listeningPort(in text: String) -> Int? {
        guard let range = text.range(of: #"127\.0\.0\.1:(\d+)"#, options: .regularExpression) else { return nil }
        return Int(text[range].split(separator: ":").last ?? "")
    }

    private func request(path: String, method: String, body: Data?) async throws -> Data {
        guard let baseURL else { throw TranslatorClientError.notRunning }
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw TranslatorClientError.notRunning
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            if let failure = try? JSONDecoder().decode(TranslatorFailure.self, from: data) {
                throw TranslatorClientError.failed(failure.message)
            }
            throw TranslatorClientError.failed("번역 서버가 HTTP \(status)로 답했습니다.")
        }
        return data
    }
}
