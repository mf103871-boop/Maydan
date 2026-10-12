import AVFoundation
import UIKit

@MainActor
final class SocialVoiceRecorder: NSObject, AVAudioRecorderDelegate {
    var onEvent: (([String: Any]) -> Void)?
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var startedAt: Date?
    private var generation = 0
    private var starting = false
    var isRecording: Bool { recorder != nil }

    static func permission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { allowed in continuation.resume(returning: allowed) }
        }
    }

    func start() async throws -> [String: Any] {
        guard recorder == nil, !starting else { throw SocialNativeError.failed("AUDIO_BUSY") }
        starting = true
        let attempt = generation
        defer { starting = false }
        guard await Self.permission() else { throw SocialNativeError.failed("MICROPHONE_DENIED") }
        guard generation == attempt else { throw SocialNativeError.failed("AUDIO_CANCELLED") }
        guard UIApplication.shared.applicationState == .active else { throw SocialNativeError.failed("AUDIO_BUSY") }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("maydan-voice-\(UUID().uuidString).m4a")
        do {
            let audio = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 24_000,
                AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48_000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ])
            audio.delegate = self
            guard audio.prepareToRecord(), audio.record(forDuration: 120) else { throw SocialNativeError.failed("AUDIO_RECORDING") }
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            recordingURL = url
            recorder = audio
            startedAt = Date()
            onEvent?(["state": "recording"])
            return ["state": "recording", "maximumDurationMs": 120_000]
        } catch {
            try? FileManager.default.removeItem(at: url)
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
    }

    func stop() throws -> [String: Any] {
        guard let audio = recorder, let url = recordingURL else { throw SocialNativeError.failed("AUDIO_NOT_RECORDING") }
        let duration = min(120, max(audio.currentTime, Date().timeIntervalSince(startedAt ?? Date())))
        audio.delegate = nil
        audio.stop()
        recorder = nil
        recordingURL = nil
        startedAt = nil
        defer {
            try? FileManager.default.removeItem(at: url)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        let data = try Data(contentsOf: url)
        guard duration >= 0.3, !data.isEmpty, data.count <= 2_000_000 else { throw SocialNativeError.failed("AUDIO_TOO_SHORT") }
        return ["base64": data.base64EncodedString(), "mimeType": "audio/mp4", "durationMs": Int(duration * 1_000)]
    }

    func cancel(state: String = "cancelled") {
        generation += 1
        guard recorder != nil else { return }
        recorder?.delegate = nil
        recorder?.stop()
        recorder = nil
        if let url = recordingURL { try? FileManager.default.removeItem(at: url) }
        recordingURL = nil
        startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        onEvent?(["state": state])
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.recorder === recorder else { return }
            if flag, let audio = try? self.stop() {
                self.onEvent?(audio.merging(["state": "ready"], uniquingKeysWith: { _, new in new }))
            } else { self.cancel(state: "interrupted") }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor [weak self] in self?.cancel(state: "interrupted") }
    }
}
